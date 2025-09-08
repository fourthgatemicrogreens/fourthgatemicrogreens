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

      // Build shipping address HTML
      const addressHTML = `
        ${orderData.address.line1 || ""} ${orderData.address.line2 || ""}<br>
        ${orderData.address.city || ""}, ${orderData.address.state || ""} ${orderData.address.postal_code || ""}<br>
        ${orderData.address.country || ""}
      `;

      // --- Business email ---
      const msg = {
        to: "fourthgatemicrogreens@gmail.com",
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

      // --- Customer confirmation email (branded) ---
      if (orderData.email && orderData.email !== "N/A") {
        const customerMsg = {
          to: orderData.email,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: "🌱 Your Fourth Gate Microgreens Order Confirmation",
          html: `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; padding:20px; border:1px solid #eee; border-radius:10px; background:#f8f7f3;">
              <!-- Header -->
              <div style="text-align:center; padding-bottom:20px; border-bottom:2px solid #3B7235;">
                <h1 style="margin:0; font-size:28px; color:#3B7235;">Fourth Gate Microgreens</h1>
                <p style="margin:0; font-size:14px; color:#666;">Fresh, local, farm-to-table greens 🌱</p>
              </div>

              <!-- Body -->
              <div style="padding:20px 0;">
                <h2 style="color:#2D4026;">Thank you for your order!</h2>
                <p>We’ve received your payment of <strong>$${orderData.amount}</strong>. Your order is now being prepared.</p>

                <h3 style="margin-top:20px; color:#3B7235;">📦 Shipping Address</h3>
                <p style="margin:0 0 10px 0;">${addressHTML}</p>

                <h3 style="margin-top:20px; color:#3B7235;">🧾 Order Details</h3>
                <p style="margin:0;"><strong>Order ID:</strong> ${orderData.sessionId}</p>
                <p style="margin:0;"><strong>Status:</strong> ${orderData.status}</p>
              </div>

              <!-- Footer -->
              <div style="text-align:center; border-top:2px solid #3B7235; padding-top:15px; margin-top:20px; font-size:13px; color:#666;">
                <p>We’ll let you know when your microgreens are on their way 🌱</p>
                <p>— The Fourth Gate Team</p>
              </div>
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
