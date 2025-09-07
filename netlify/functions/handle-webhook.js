const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.config = {
  bodyParser: false, // Required for Stripe webhook signature verification
};

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  switch (stripeEvent.type) {
    case 'checkout.session.completed':
      const session = stripeEvent.data.object;

      // Extract details
      const email = session.customer_details?.email || 'N/A';
      const amount = session.amount_total
        ? `$${(session.amount_total / 100).toFixed(2)}`
        : 'N/A';

      const address = session.customer_details?.address;
      const formattedAddress = address
        ? `${address.line1 || ''} ${address.line2 || ''}, ${address.city || ''}, ${address.state || ''} ${address.postal_code || ''}, ${address.country || ''}`
        : 'No address provided';

      console.log("✅ Payment successful:");
      console.log(`   Email: ${email}`);
      console.log(`   Amount Paid: ${amount}`);
      console.log(`   Shipping Address: ${formattedAddress}`);
      console.log(`   Session ID: ${session.id}`);

      // 👉 TODO: Save order to DB or send email here

      break;

    default:
      console.log(`ℹ️ Unhandled event type: ${stripeEvent.type}`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
