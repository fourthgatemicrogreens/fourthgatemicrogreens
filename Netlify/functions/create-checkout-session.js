// This is your new serverless function that will handle the Stripe checkout.
// You would save this file as 'create-checkout-session.js' inside a 'netlify/functions' folder in your project.

// Import the Stripe library
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // The frontend will send a POST request with the order data in the body.
  const data = JSON.parse(event.body);

  // A helper function to generate the product description.
  const generateDescription = () => {
    if (data.orderType === 'preset' && data.selectedPreset) {
      return `${data.selectedPreset.name} (${data.selectedPresetSize}oz)`;
    } else if (data.orderType === 'custom') {
      const totalOz = Object.values(data.customBox).reduce((sum, qty) => sum + qty, 0) * 4;
      return `Custom Box (${totalOz}oz)`;
    }
    return 'Microgreens Box';
  };

  const description = generateDescription();
  // The price must be in cents.
  const priceInCents = Math.round(data.totalPrice * 100);

  try {
    // Create a Checkout Session with the order details.
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: description,
            },
            unit_amount: priceInCents,
            // For subscriptions, we need to specify the interval.
            recurring: {
              interval: data.deliveryFrequency === 'Weekly' ? 'week' : (data.deliveryFrequency === 'Bi-weekly' ? 'week' : 'month'),
              interval_count: data.deliveryFrequency === 'Bi-weekly' ? 2 : 1,
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription', // Use 'subscription' mode for recurring payments.
      // Set the success and cancel URLs. These are the pages the user will be redirected to after payment.
      // You'll need to replace these with your actual success and cancel page URLs on your live site.
      success_url: `${process.env.URL}/success.html`,
      cancel_url: `${process.env.URL}/cancel.html`,
    });

    // Return the session ID to the frontend.
    return {
      statusCode: 200,
      body: JSON.stringify({ id: session.id }),
    };
  } catch (error) {
    console.error('Error creating Stripe session:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to create payment session.' }),
    };
  }
};
