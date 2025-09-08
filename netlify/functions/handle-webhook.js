const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

// Init Firebase Admin
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

// Init SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.config = { bodyParser: false };

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    const orderData = {
      email: session.customer_details?.email || 'N/A',
      amount: session.amount_total ? session.amount_total / 100 : 0,
      address: session.customer_details?.address || {},
      status: session.payment_status,
      sessionId: session.id,
      createdAt: new Date(),
    };

    try {
      // Save order in Firestore
      await db.collection('orders').add(orderData);
      console.log("✅ Order saved:", orderData);

      // Send yourself an email
      const msg = {
        to: "your-email@example.com", // 👈 where you want notifications
        from: process.env.SENDGRID_FROM_EMAIL, // must be verified in SendGrid
        subject: `🌱 New Order - ${orderData.email}`,
        text: `
New order received!

Customer: ${orderData.email}
Amount: $${orderData.amount}
Status: ${orderData.status}

Shipping Address:
${orderData.address.line1 || ""} ${orderData.address.line2 || ""}
${orderData.address.city || ""}, ${orderData.address.state || ""} ${orderData.address.postal_code || ""}
${orderData.address.country || ""}

Session ID: ${orderData.sessionId}
        `,
      };

      await sgMail.send(msg);
      console.log("📧 Email sent for new order");

    } catch (err) {
      console.error("❌ Error:", err);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

