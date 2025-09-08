const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const YOUR_DOMAIN = process.env.YOUR_DOMAIN || 'http://localhost:8888';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Expecting: { priceId, quantity, boxMeta }
    const { priceId, quantity = 1, boxMeta } = JSON.parse(event.body || '{}');

    if (!priceId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing priceId' }),
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', // must match your Price configuration
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity,
        },
      ],

      // Collect shipping info
      shipping_address_collection: {
        allowed_countries: ['US', 'CA'],
      },

      // Attach metadata to subscription
      subscription_data: {
        metadata: {
          ...(boxMeta || {}),
        },
      },

      // Also attach metadata at session level
      metadata: {
        ...(boxMeta || {}),
      },

      success_url: `${YOUR_DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${YOUR_DOMAIN}/cancel.html`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id }),
    };
  } catch (error) {
    console.error('❌ Stripe API Error:', error);

    // Return the error message back to frontend for debugging
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || 'Failed to create Stripe Checkout session.',
      }),
    };
  }
};
