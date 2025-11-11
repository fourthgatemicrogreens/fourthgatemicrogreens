// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    const { lineItems, priceId, boxMeta } = JSON.parse(event.body);

    let finalLineItems = lineItems;
    if (!finalLineItems && priceId) {
        finalLineItems = [{ price: priceId, quantity: 1 }];
    }

    if (!finalLineItems || finalLineItems.length === 0) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'No items selected for purchase.' }),
        };
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: finalLineItems,
      mode: 'subscription',
      success_url: `${process.env.URL}/success.html`,
      cancel_url: `${process.env.URL}/`,
      // Enable native shipping address collection for US
      shipping_address_collection: {
        allowed_countries: ['US'],
      },
      metadata: boxMeta,
      subscription_data: {
        metadata: boxMeta,
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id }),
    };
  } catch (error) {
    console.error('Stripe Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to create checkout session. Please try again.' }),
    };
  }
};
