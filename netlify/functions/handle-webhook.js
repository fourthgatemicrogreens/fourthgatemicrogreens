const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Needed to properly parse raw body
exports.config = {
  bodyParser: false, // disable Netlify's JSON body parser
};

exports.handler = async (event, context) => {
  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // add this in Netlify settings

  let eventObject;

  try {
    eventObject = stripe.webhooks.constructEvent(
      event.body,
      sig,
      endpointSecret
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`,
    };
  }

  // Handle the event type you care about
  switch (eventObject.type) {
    case 'checkout.session.completed':
      const session = eventObject.data.object;
      console.log('✅ Payment was successful for session:', session.id);

      // TODO: Save order in DB, trigger email, etc.
      break;

    default:
      console.log(`Unhandled event type ${eventObject.type}`);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true }),
  };
};
