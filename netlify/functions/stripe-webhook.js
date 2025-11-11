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

    // Start with whatever metadata is on the session itself
    let finalMetadata = session.metadata || {};

    // If there's a subscription, fetch it to get its metadata too
    if (session.subscription) {
        try {
            console.log(`Fetching subscription ${session.subscription} to get metadata...`);
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
            // Merge them, trusting subscription metadata more if there's a conflict
            finalMetadata = { ...finalMetadata, ...subscription.metadata };
            console.log("Merged metadata:", finalMetadata);
        } catch (error) {
            console.error("Error fetching subscription:", error);
        }
    }

    // Safely parse customContents, defaulting to an empty object if missing or invalid
    let parsedCustomContents = {};
    if (finalMetadata.customContents) {
        try {
            parsedCustomContents = JSON.parse(finalMetadata.customContents);
        } catch (e) {
            console.error("Error parsing customContents JSON:", e);
        }
    }

    // Parse the new delivery address from metadata
    let deliveryAddress = {};
    if (finalMetadata.deliveryAddress) {
        try {
            deliveryAddress = JSON.parse(finalMetadata.deliveryAddress);
        } catch (e) {
            console.error("Error parsing deliveryAddress JSON:", e);
        }
    }

    const orderData = {
      stripeSessionId: session.id,
      stripeCustomerId: session.customer,
      customerEmail: session.customer_details?.email,
      customerName: session.customer_details?.name,
      amountTotal: session.amount_total / 100,
      currency: session.currency,
      paymentStatus: session.payment_status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      
      // Explicitly save these fields from our final merged metadata
      boxType: finalMetadata.boxType || null,
      customContents: parsedCustomContents,
      deliveryDay: finalMetadata.deliveryDay || null,
      rotationFavorites: finalMetadata.rotationFavorites || null,
      wheatgrassQuantity: finalMetadata.wheatgrassQuantity ? parseInt(finalMetadata.wheatgrassQuantity) : 0,
      deliveryAddress: deliveryAddress, // Save the new address object
      
      subscriptionId: session.subscription || null,
    };

    try {
      await db.collection('orders').doc(session.id).set(orderData);
      console.log(`SUCCESS: Order ${session.id} saved to Firebase with metadata.`);
    } catch (error) {
      console.error('Firebase save error:', error);
      return { statusCode: 500, body: 'Error saving to database' };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

Once you've updated both the frontend (`index-31.html`) and the backend (`stripe-webhook.js`), your new orders will include the full delivery address in Firebase!
