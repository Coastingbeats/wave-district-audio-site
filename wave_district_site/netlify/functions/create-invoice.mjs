// Netlify serverless function: creates a Stripe customer + a 50% deposit
// invoice from the quote builder, then finalizes and emails it via Stripe.
//
// Requires an environment variable STRIPE_SECRET_KEY to be set in your
// Netlify site (Site settings -> Environment variables). Never put the
// secret key in any file that gets deployed to the site itself.

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Stripe is not configured yet on this site.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let data;
  try {
    data = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { name, email, phone, details, lines } = data || {};
  if (!email || !Array.isArray(lines) || lines.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing email or selected services.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = { Authorization: `Bearer ${STRIPE_SECRET_KEY}` };

  async function stripePost(path, body) {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    const json = await res.json();
    if (!res.ok) throw new Error((json.error && json.error.message) || 'Stripe request failed');
    return json;
  }

  async function stripeGet(path) {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: authHeader });
    const json = await res.json();
    if (!res.ok) throw new Error((json.error && json.error.message) || 'Stripe request failed');
    return json;
  }

  try {
    // Find an existing Stripe customer by email, or create a new one.
    const found = await stripeGet(`customers/search?query=${encodeURIComponent(`email:'${email}'`)}`);
    let customerId;
    if (found.data && found.data.length > 0) {
      customerId = found.data[0].id;
    } else {
      const customer = await stripePost('customers', {
        email: email,
        name: name || '',
        phone: phone || '',
      });
      customerId = customer.id;
    }

    // Add one invoice item per selected service, billed at 50% (deposit).
    let depositTotalCents = 0;
    for (const line of lines) {
      const fullCents = Math.round(Number(line.total) * 100);
      const depositCents = Math.round(fullCents * 0.5);
      if (depositCents <= 0) continue;
      depositTotalCents += depositCents;
      await stripePost('invoiceitems', {
        customer: customerId,
        currency: 'usd',
        amount: String(depositCents),
        description: `50% Deposit — ${line.name}`,
      });
    }

    if (depositTotalCents <= 0) {
      return new Response(JSON.stringify({ error: 'Nothing to invoice.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create the invoice, collecting it by emailing the customer (not auto-charging).
    // NOTE: Stripe's default for new invoices is to NOT auto-attach pending
    // invoice items (pending_invoice_items_behavior defaults to "exclude" on
    // current API versions). Without this flag the invoice comes out empty
    // ($0 due), which Stripe then auto-marks as paid and refuses to "send"
    // (that's the "cannot be sent right now" error). Explicitly including
    // pending items pulls in the invoiceitems created just above.
    const invoice = await stripePost('invoices', {
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: '7',
      pending_invoice_items_behavior: 'include',
      description: details
        ? `Wave District Audio — 50% deposit. Project details: ${details}`
        : 'Wave District Audio — 50% deposit',
    });

    await stripePost(`invoices/${invoice.id}/finalize`, {});
    const sent = await stripePost(`invoices/${invoice.id}/send`, {});

    return new Response(JSON.stringify({
      success: true,
      invoiceUrl: sent.hosted_invoice_url || null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Something went wrong sending the invoice.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = {
  path: '/api/create-invoice',
};
