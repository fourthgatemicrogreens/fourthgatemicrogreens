// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    console.log(`Processing checkout session ${session.id}`);

    // 1. Fetch full customer details to ensure we get name and email
    let customer = {};
    if (session.customer) {
        try {
            customer = await stripe.customers.retrieve(session.customer);
        } catch (e) {
            console.error("Error fetching customer:", e);
        }
    }

    // 2. Merge metadata from session and subscription
    let finalMetadata = session.metadata || {};
    if (session.subscription) {
        try {
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
            finalMetadata = { ...finalMetadata, ...subscription.metadata };
        } catch (error) {
            console.error("Error fetching subscription:", error);
        }
    }

    // 3. Safely parse JSON fields from metadata
    let parsedCustomContents = {};
    try {
        parsedCustomContents = finalMetadata.customContents ? JSON.parse(finalMetadata.customContents) : {};
    } catch (e) { console.error("Error parsing customContents:", e); }

    let parsedDeliveryAddress = {};
    try {
        parsedDeliveryAddress = finalMetadata.deliveryAddress ? JSON.parse(finalMetadata.deliveryAddress) : {};
    } catch (e) { console.error("Error parsing deliveryAddress:", e); }

    // 4. Construct the final order object for Firebase
    const orderData = {
      stripeSessionId: session.id,
      stripeCustomerId: session.customer,
      // Try getting email/name from multiple possible sources, preferring the most reliable first
      customerEmail: customer.email || session.customer_details?.email || session.customer_email,
      customerName: customer.name || session.customer_details?.name,
      amountTotal: session.amount_total / 100,
      currency: session.currency,
      paymentStatus: session.payment_status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      
      // Custom Business Data
      boxType: finalMetadata.boxType || null,
      customContents: parsedCustomContents,
      deliveryDay: finalMetadata.deliveryDay || null,
      rotationFavorites: finalMetadata.rotationFavorites || null,
      wheatgrassQuantity: finalMetadata.wheatgrassQuantity ? parseInt(finalMetadata.wheatgrassQuantity) : 0,
      deliveryAddress: parsedDeliveryAddress, // Use the parsed address object
      
      subscriptionId: session.subscription || null,
    };

    try {
      await db.collection('orders').doc(session.id).set(orderData);
      console.log(`SUCCESS: Order ${session.id} saved to Firebase.`);
    } catch (error) {
      console.error('Firebase save error:', error);
      return { statusCode: 500, body: 'Error saving to database' };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
