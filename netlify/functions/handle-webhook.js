// netlify/functions/handle-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

// --- INITIALIZATION ---
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
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.config = { bodyParser: false };

// --- HELPER: Format Order Items for Email ---
function formatOrderItemsHTML(metadata, customContents) {
    let html = '<ul style="padding-left:20px; margin-top:0;">';
    
    // Custom Box Items
    for (const [crop, qty] of Object.entries(customContents)) {
        html += `<li><strong>${crop}:</strong> ${qty * 4}oz</li>`;
    }
    
    // Wheatgrass
    if (metadata.wheatgrassQuantity > 0) {
        html += `<li><strong>Wheatgrass (5x5 tray):</strong> Qty ${metadata.wheatgrassQuantity}</li>`;
    }

    // Fallback if empty (shouldn't happen with current frontend validation)
    if (html === '<ul style="padding-left:20px; margin-top:0;">') {
        html += '<li>No specific items listed.</li>';
    }

    html += '</ul>';
    
    if (metadata.deliveryDay) {
         html += `<p><strong>Preferred Delivery Day:</strong> ${metadata.deliveryDay}</p>`;
    }

    return html;
}

// --- MAIN HANDLER ---
exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    console.log(`Processing session ${session.id}`);

    // 1. FETCH ENHANCED DATA (Customer & Subscription)
    let customer = {};
    if (session.customer) {
        try {
            customer = await stripe.customers.retrieve(session.customer);
        } catch (e) { console.error("Error fetching customer:", e); }
    }

    // Merge metadata from subscription if it exists (crucial for recurring orders)
    let finalMetadata = session.metadata || {};
    if (session.subscription) {
        try {
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
            finalMetadata = { ...finalMetadata, ...subscription.metadata };
        } catch (e) { console.error("Error fetching subscription:", e); }
    }

    // Parse the custom contents JSON we sent from frontend
    let parsedCustomContents = {};
    try {
        parsedCustomContents = finalMetadata.customContents ? JSON.parse(finalMetadata.customContents) : {};
    } catch (e) { console.error("Error parsing customContents:", e); }

    // 2. ROBUST ADDRESS EXTRACTION (The Native Stripe way)
    // shipping_details is usually where verified shipping addresses go in Checkout
    const shipping = session.shipping_details || session.customer_details || customer.shipping;
    const deliveryAddress = {
        line1: shipping?.address?.line1 || '',
        line2: shipping?.address?.line2 || '',
        city: shipping?.address?.city || '',
        state: shipping?.address?.state || '',
        postal_code: shipping?.address?.postal_code || '',
        country: shipping?.address?.country || '',
        recipient_name: shipping?.name || session.customer_details?.name || 'Valued Customer'
    };

    // 3. PREPARE ORDER DATA FOR FIRESTORE
    const orderData = {
        stripeSessionId: session.id,
        stripeCustomerId: session.customer,
        customerEmail: session.customer_details?.email || customer.email || 'N/A',
        customerName: deliveryAddress.recipient_name,
        amountTotal: session.amount_total / 100,
        currency: session.currency,
        paymentStatus: session.payment_status,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        // Custom Metadata Fields
        boxType: finalMetadata.boxType || 'N/A',
        customContents: parsedCustomContents,
        wheatgrassQuantity: finalMetadata.wheatgrassQuantity ? parseInt(finalMetadata.wheatgrassQuantity) : 0,
        deliveryDay: finalMetadata.deliveryDay || 'N/A',
        rotationFavorites: finalMetadata.rotationFavorites || null,
        deliveryAddress: deliveryAddress,
        subscriptionId: session.subscription || null,
    };

    try {
      // 4. SAVE TO FIRESTORE
      await db.collection('orders').doc(session.id).set(orderData);
      console.log("✅ Order saved to Firestore:", session.id);

      // 5. SEND EMAILS (Enhanced with actual order details)
      
      // Prepare HTML snippets
      const addressHTML = `
        <strong>${deliveryAddress.recipient_name}</strong><br>
        ${deliveryAddress.line1} ${deliveryAddress.line2}<br>
        ${deliveryAddress.city}, ${deliveryAddress.state} ${deliveryAddress.postal_code}<br>
        ${deliveryAddress.country}
      `;
      
      const orderItemsHTML = formatOrderItemsHTML(finalMetadata, parsedCustomContents);

      // -- Business notification email --
      const msg = {
        to: "fourthgatemicrogreens@gmail.com", // Your business email
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: `🌱 New Order! $${orderData.amountTotal} from ${orderData.customerName}`,
        html: `
          <h2>🌱 New Order Received</h2>
          <p><strong>Customer:</strong> ${orderData.customerName} (${orderData.customerEmail})</p>
          <p><strong>Amount:</strong> $${orderData.amountTotal}</p>
          <hr>
          <h3>📦 Order Contents (${finalMetadata.boxType})</h3>
          ${orderItemsHTML}
          ${finalMetadata.rotationFavorites ? `<p><strong>Rotation Preferences:</strong><br><em>${finalMetadata.rotationFavorites}</em></p>` : ''}
          <hr>
          <h3>🚚 Shipping Address</h3>
          <p>${addressHTML}</p>
        `,
      };
      await sgMail.send(msg);
      console.log("📧 Business email sent");

      // -- Customer confirmation email --
      if (orderData.customerEmail && orderData.customerEmail !== 'N/A') {
        const customerMsg = {
          to: orderData.customerEmail,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: "🌱 Order Confirmed: Fourth Gate Microgreens",
          html: `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width:600px; margin:auto; color:#2D4026; background:#f8f7f3;">
              <div style="background:#3B7235; padding:20px; text-align:center; color:white;">
                <h1 style="margin:0; font-family: 'Georgia', serif;">Fourth Gate Microgreens</h1>
              </div>
              <div style="padding:30px; background:#ffffff; border-radius:0 0 8px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                <h2 style="color:#3B7235; margin-top:0;">Thank you, ${orderData.customerName.split(' ')[0]}!</h2>
                <p>We're excited to get growing for you. Since we grow to order, please allow about two weeks for your first delivery to ensure peak freshness.</p>
                
                <div style="background:#F2F9F2; padding:20px; border-radius:12px; margin:25px 0;">
                  <h3 style="margin-top:0; color:#3B7235;">🥗 Your Weekly Order</h3>
                  ${orderItemsHTML}
                  <p style="margin-bottom:0; margin-top:15px;"><strong>Total:</strong> $${orderData.amountTotal.toFixed(2)}/week</p>
                </div>

                <div style="margin-bottom:25px;">
                    <h3 style="color:#3B7235; border-bottom:1px solid #eee; padding-bottom:10px;">📍 Delivery Details</h3>
                    <p>${addressHTML}</p>
                </div>

                <p style="font-size:14px; color:#666;">Need to make changes? Just reply to this email and we'll help you out.</p>
              </div>
              <div style="text-align:center; padding:20px; font-size:12px; color:#888;">
                © ${new Date().getFullYear()} Fourth Gate Microgreens
              </div>
            </div>
          `,
        };
        await sgMail.send(customerMsg);
        console.log("📧 Customer email sent to:", orderData.customerEmail);
      }

    } catch (err) {
      console.error("❌ Error in Firestore/Email processing:", err);
      // Don't return 500 here if possible, as Stripe will retry. 
      // If the order SAVED but email failed, we might not want to retry the whole thing.
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
