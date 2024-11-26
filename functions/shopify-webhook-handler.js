const axios = require('axios');
const crypto = require('crypto');

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const CALENDLY_API_TOKEN = process.env.CALENDLY_API_TOKEN;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const ADMIN_API_ACCESS_TOKEN = process.env.ADMIN_API_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;

exports.handler = async (event, context) => {
  try {
    const hmacHeader = event.headers['x-shopify-hmac-sha256'];
    const body = event.body;

    if (!verifyShopifyWebhook(hmacHeader, body)) {
      return { statusCode: 401, body: 'Invalid request' };
    }

    const order = JSON.parse(body);
    const customerEmail = order.email;
    const firstName = order.customer.first_name;
    const lastName = order.customer.last_name;

    console.log(
      `Received order from ${firstName} ${lastName} (${customerEmail})`
    );

    let schedulingLinks = []; // Array to hold all scheduling links

    for (const lineItem of order.line_items) {
      const productId = lineItem.product_id;
      const quantity = lineItem.quantity; // Number of times the event was purchased

      const eventHandle = await getCalendlyEventHandle(productId);

      if (eventHandle) {
        console.log(
          `Product ${lineItem.title} has a Calendly event handle: ${eventHandle}`
        );

        // Get the Calendly Event Type URI based on the handle
        const eventTypeUri = await getCalendlyEventTypeUri(eventHandle);

        if (eventTypeUri) {
          // Generate a unique link for each item in the quantity
          for (let i = 0; i < quantity; i++) {
            const schedulingLink = await createCalendlySchedulingLink({
              email: customerEmail,
              firstName,
              lastName,
              eventTypeUri,
            });

            schedulingLinks.push({
              title: `${lineItem.title} (Ticket ${i + 1})`,
              link: schedulingLink,
            });
          }
        } else {
          console.warn(`No matching event found for handle: ${eventHandle}`);
        }
      }
    }

    // Track the event in Klaviyo with all scheduling links
    if (schedulingLinks.length > 0) {
      await trackKlaviyoEvent({
        email: customerEmail,
        firstName,
        lastName,
        schedulingLinks,
        orderId: order.id,
        orderTime: order.created_at,
      });

      // Add all scheduling links to Shopify order notes
      await addNoteToShopifyOrder({
        orderId: order.id,
        schedulingLinks,
      });
    }

    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error processing webhook:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

// Function to verify Shopify webhook signature
function verifyShopifyWebhook(hmacHeader, body) {
  const generatedHash = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  return generatedHash === hmacHeader;
}

// Function to retrieve the Calendly event handle from metaobject using GraphQL
async function getCalendlyEventHandle(productId) {
  // ... (No changes to this function)
}

// Function to get Calendly Event Type URI based on event handle
async function getCalendlyEventTypeUri(eventHandle) {
  // ... (No changes to this function)
}

// Function to create Calendly scheduling link
async function createCalendlySchedulingLink({ email, firstName, lastName, eventTypeUri }) {
  // ... (No changes to this function)
}

// Updated function to track a custom event in Klaviyo
async function trackKlaviyoEvent({
  email,
  firstName,
  lastName,
  schedulingLinks,
  orderId,
  orderTime,
}) {
  try {
    // Klaviyo expects the event time as a Unix timestamp in seconds
    const eventTime = Math.floor(new Date(orderTime).getTime() / 1000);

    await axios.post(
      'https://a.klaviyo.com/api/events/',
      {
        data: {
          type: 'event',
          attributes: {
            event_name: 'Order Contains Event',
            profile: {
              data: {
                type: 'profile',
                attributes: {
                  email: email,
                  first_name: firstName,
                  last_name: lastName,
                },
              },
            },
            properties: {
              scheduling_links: schedulingLinks,
              order_id: orderId,
            },
            time: eventTime,
          },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          revision: '2023-07-15',
        },
      }
    );
    console.log(
      'Tracked Klaviyo event for purchase with multiple scheduling links.'
    );
  } catch (error) {
    console.error(
      'Error tracking Klaviyo event:',
      JSON.stringify(
        error.response ? error.response.data : error.message,
        null,
        2
      )
    );
    throw new Error('Failed to track Klaviyo event');
  }
}

// Function to add a note with multiple scheduling links to the Shopify order using GraphQL
async function addNoteToShopifyOrder({ orderId, schedulingLinks }) {
  // ... (No changes to this function)
}
