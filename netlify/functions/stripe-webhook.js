// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Replace escaped newlines with actual newlines
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    // Verify the event came from Stripe
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Handle the event
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    // 1. Get customer details
    const customerId = session.customer;
    const customerEmail = session.customer_details.email;
    const customerName = session.customer_details.name;

    // 2. Get the metadata (this is where your custom info is!)
    // We check both session metadata and subscription metadata to be safe.
    let metadata = session.metadata;
    if (session.subscription) {
        try {
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
             // Merge subscription metadata, giving it priority if it exists
            metadata = { ...metadata, ...subscription.metadata };
        } catch (error) {
             console.error("Error retrieving subscription:", error);
        }
    }

    // 3. Prepare data for Firebase
    const orderData = {
      stripeSessionId: session.id,
      stripeCustomerId: customerId,
      customerEmail: customerEmail,
      customerName: customerName,
      amountTotal: session.amount_total / 100, // Convert from cents to dollars
      currency: session.currency,
      paymentStatus: session.payment_status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      
      // Custom Business Data from Metadata
      boxType: metadata.boxType || 'unknown',
      customContents: metadata.customContents ? JSON.parse(metadata.customContents) : {},
      deliveryDay: metadata.deliveryDay || 'Not specified',
      rotationFavorites: metadata.rotationFavorites || '',
      wheatgrassQuantity: parseInt(metadata.wheatgrassQuantity) || 0,
      subscriptionId: session.subscription || null,
    };

    try {
      // 4. Save to Firebase 'orders' collection
      await db.collection('orders').doc(session.id).set(orderData);
      console.log(`Order ${session.id} saved to Firebase.`);
    } catch (error) {
      console.error('Error saving to Firebase:', error);
      return { statusCode: 500, body: 'Error saving to database' };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};