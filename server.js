const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/create-setup-intent', async (req, res) => {
  try {
    const { name, email, address } = req.body;

    // Log received data for debugging
    console.log('Received customer data:', { name, email, address });

    // Validate required fields
    if (!name || !email || !address || !address.country) {
      const errorMsg = 'Missing required customer details: name, email, or address';
      console.error(errorMsg);
      return res.status(400).json({ error: errorMsg });
    }

    // Create Stripe customer with name, email, and address
    const customer = await stripe.customers.create({
      name: name,
      email: email,
      address: address
    });

    // Log created customer for debugging
    console.log('Created Stripe customer:', customer);

    // Create SetupIntent for the customer
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['au_becs_debit', 'card']
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId: customer.id
    });
  } catch (error) {
    console.error('Error in /create-setup-intent:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/create-subscription-final', async (req, res) => {
  try {
    const { customerId, setupIntentId, priceId } = req.body;

    if (!customerId || !setupIntentId || !priceId) {
      return res.status(400).json({ error: 'Missing customerId, setupIntentId, or priceId' });
    }

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    const paymentMethod = setupIntent.payment_method;

    await stripe.paymentMethods.attach(paymentMethod, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethod }
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      expand: ['latest_invoice.payment_intent']
    });

    res.json({ subscriptionId: subscription.id });
  } catch (error) {
    console.error('Error in /create-subscription-final:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/send-details-email', async (req, res) => {
  try {
    const {
      location,
      plan,
      firstName,
      lastName,
      dob,
      phone,
      email,
      address,
      state,
      city,
      postcode,
      emergencyFirst,
      emergencyLast,
      emergencyPhone
    } = req.body;

    // Validate required fields (mirror client-side validation)
    if (!location || !plan || !firstName || !lastName || !dob || !phone || !email || !address || !state || !city || !postcode) {
      return res.status(400).json({ error: 'Missing required details' });
    }

    // Mapping of locations to emails
    const locationEmails = {
      'northsydney': 'northsydney@lyf247.com.au',
      'figtree': 'figtree@lyf247.com.au',
      'sevenhills': 'sevenhills@lyf247.com.au',
      'kogarah': 'kogarah@lyf247.com.au'
      // Add more locations here as needed
    };

    const toEmail = locationEmails[location] || 'brodie@lyf247.com.au'; // Fallback to your email if location not found

    // Set up Nodemailer transporter using env vars
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465', // true for SSL (port 465), false for TLS (port 587)
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    // Email options
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: toEmail,
      cc: 'brodie@lyf247.com.au', // CC to you for all emails
      subject: `New Membership Details Submitted for ${plan} at ${location}`,
      text: `A new user has submitted their details for a ${plan} membership at ${location}.

Personal Information:
- Name: ${firstName} ${lastName}
- Date of Birth: ${dob}
- Phone: ${phone}
- Email: ${email}
- Address: ${address}, ${city}, ${state} ${postcode}

Emergency Contact:
- Name: ${emergencyFirst || 'N/A'} ${emergencyLast || ''}
- Phone: ${emergencyPhone || 'N/A'}

Note: This is before payment processing. The user is being redirected to the payment page.`
    };

    // Send email
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${toEmail} (CC: brodie@lyf247.com.au) for location ${location}`);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in /send-details-email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
