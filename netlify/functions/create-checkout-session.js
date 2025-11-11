// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    const { lineItems, priceId, boxMeta } = JSON.parse(event.body);

    // 1. Determine the items to be purchased
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

    // 2. Create the Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: finalLineItems,
      mode: 'subscription',
      success_url: `${process.env.URL}/success.html`,
      cancel_url: `${process.env.URL}/`,
      // Attach metadata to the Checkout Session itself (good for debugging)
      metadata: boxMeta,
      // CRITICAL CHANGE: Attach metadata to the Subscription object
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
