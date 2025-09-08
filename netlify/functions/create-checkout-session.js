const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const YOUR_DOMAIN = process.env.YOUR_DOMAIN || 'http://localhost:8888';

exports.handler = async (event, context) => {
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
      mode: 'subscription', // 👈 important
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,    // 👈 your pre-created recurring Price ID
          quantity,
        },
      ],

      // ✅ Collect shipping info
      shipping_address_collection: {
        allowed_countries: ['US', 'CA'],
      },

      // ✅ Store box type info in subscription metadata
      subscription_data: {
        metadata: {
          ...(boxMeta || {}), // e.g. { boxType:'green-mix' } or { boxType:'custom', contents:'kale,arugula' }
        },
      },

      // ✅ Also store metadata at session level (so webhook sees it immediately)
      metadata: {
        ...(boxMeta || {}),
      },

      success_url: `${YOUR_DOMAIN}/success.html`,
      cancel_url: `${YOUR_DOMAIN}/cancel.html`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id }),
    };
  } catch (error) {
    console.error('Stripe API Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to create Stripe Checkout session.' }),
    };
  }
};
