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

      // --- HTML Email Templates ---
      const addressHTML = `
        ${orderData.address.line1 || ""} ${orderData.address.line2 || ""}<br>
        ${orderData.address.city || ""}, ${orderData.address.state || ""} ${orderData.address.postal_code || ""}<br>
        ${orderData.address.country || ""}
      `;

      // Business email (to you)
      const msg = {
        to: "fourthgatemicrogreens@gmail.com", // your inbox
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: `🌱 New Order - ${orderData.email}`,
        html: `
          <h2>🌱 New Order Received</h2>
          <p><strong>Customer:</strong> ${orderData.email}</p>
          <p><strong>Amount:</strong> $${orderData.amount}</p>
          <p><strong>Status:</strong> ${orderData.status}</p>
          <p><strong>Shipping Address:</strong><br>${addressHTML}</p>
          <p><strong>Session ID:</strong> ${orderData.sessionId}</p>
          <hr>
          <small>Fourth Gate Microgreens - Order Notification</small>
        `,
      };

      await sgMail.send(msg);
      console.log("📧 Business email sent");

      // Customer confirmation email
      if (orderData.email && orderData.email !== "N/A") {
        const customerMsg = {
          to: orderData.email,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: "🌱 Your Fourth Gate Microgreens Order Confirmation",
          html: `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; padding:20px; border:1px solid #eee; border-radius:10px;">
              <h1 style="color:#2D4026;">Thank you for your order! 🌱</h1>
              <p>Hi there,</p>
              <p>We’ve received your payment of <strong>$${orderData.amount}</strong> and your order is being prepared.</p>
              <h3>Shipping Address</h3>
              <p>${addressHTML}</p>
              <h3>Order Details</h3>
              <p><strong>Order ID:</strong> ${orderData.sessionId}</p>
              <p><strong>Status:</strong> ${orderData.status}</p>
              <hr>
              <p style="color:#666;">We’ll notify you when your microgreens are on their way.<br>
              — The Fourth Gate Team 🌱</p>
            </div>
          `,
        };

        await sgMail.send(customerMsg);
        console.log("📧 Customer confirmation sent to:", orderData.email);
      }

    } catch (err) {
      console.error("❌ Error:", err);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
