// functions/shopify-webhook-handler.js

const axios = require('axios');
const crypto = require('crypto');

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
// Removed CALENDLY_API_TOKEN since we no longer use Calendly
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const ADMIN_API_ACCESS_TOKEN = process.env.ADMIN_API_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;

exports.handler = async (event, context) => {
  try {
    const hmacHeader =
      event.headers['x-shopify-hmac-sha256'] || event.headers['X-Shopify-Hmac-Sha256'];
    const body = event.body;

    if (!verifyShopifyWebhook(hmacHeader, body)) {
      console.error('Invalid webhook signature.');
      return { statusCode: 401, body: 'Invalid request' };
    }

    const order = JSON.parse(body);
    console.log('Received order object:', JSON.stringify(order, null, 2));

    // We no longer need customer email or name. We'll identify the Klaviyo event by a non-PII ID derived from the order.
    const nonPiiId = `order_${order.id}`; // Unique non-PII identifier for Klaviyo profile reference

    // Extract event product details for each line item
    const eventProducts = [];

    for (const lineItem of order.line_items) {
      const productId = lineItem.product_id;
      const quantity = lineItem.quantity;

      console.log(
        `Processing line item: ${lineItem.title}, Product ID: ${productId}, Quantity: ${quantity}`
      );

      // Retrieve event data from the product's metaobject
      const eventData = await getEventDataFromProduct(productId);

      if (eventData) {
        // Add this event product data for each purchased quantity
        for (let i = 0; i < quantity; i++) {
          eventProducts.push({
            title: eventData.title,
            map_embed: eventData.map_embed,
            address: eventData.address,
            start_date_time: eventData.start_date_time,
            end_date_time: eventData.end_date_time,
            refund_policy: eventData.refund_policy,
            calendar_embed: eventData.calendar_embed,
            line_item_title: lineItem.title,
          });
        }
      } else {
        console.warn(`No event data found for product ID: ${productId}`);
      }
    }

    console.log('Collected event product data:', JSON.stringify(eventProducts, null, 2));

    if (eventProducts.length > 0) {
      // Track the event in Klaviyo without PII. We use a unique $id based on the order ID.
      await trackKlaviyoEvent({
        nonPiiId,
        eventProducts,
        orderId: order.id,
        orderTime: order.created_at,
      });

      // Add event info to Shopify order notes
      await addNoteToShopifyOrder({
        orderId: order.id,
        eventProducts,
      });
    } else {
      console.log('No event products found, skipping Klaviyo event tracking and order note update.');
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

// Function to retrieve event data from the product's event metaobject
async function getEventDataFromProduct(productId) {
  try {
    const graphqlEndpoint = `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/graphql.json`;

    const query = `
      query GetProductEvent($productId: ID!) {
        product(id: $productId) {
          metafield(namespace: "custom", key: "event") {
            reference {
              ... on Metaobject {
                fields {
                  key
                  value
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      productId: `gid://shopify/Product/${productId}`,
    };

    const response = await axios.post(
      graphqlEndpoint,
      { query, variables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
      }
    );

    const data = response.data;

    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return null;
    }

    const metafield = data.data.product.metafield;
    if (!metafield || !metafield.reference) {
      console.log(`No 'custom.event' metafield found for product ${productId}`);
      return null;
    }

    const fields = metafield.reference.fields;

    // Extract relevant event fields
    const eventData = {};
    for (const field of fields) {
      if (field.key === 'event.title') eventData.title = field.value;
      else if (field.key === 'event.map_embed') eventData.map_embed = field.value;
      else if (field.key === 'event.address') eventData.address = field.value;
      else if (field.key === 'event.start_date_time') eventData.start_date_time = field.value;
      else if (field.key === 'event.end_date_time') eventData.end_date_time = field.value;
      else if (field.key === 'event.refund_policy') eventData.refund_policy = field.value;
      else if (field.key === 'event.calendar_embed') eventData.calendar_embed = field.value;
      // 'event.calendly_event_url_handle' is no longer needed, so we skip it
    }

    return eventData;
  } catch (error) {
    console.error(
      'Error fetching event data from product metaobject:',
      JSON.stringify(error.response ? error.response.data : error.message, null, 2)
    );
    return null;
  }
}

// Function to track an event in Klaviyo without PII
async function trackKlaviyoEvent({ nonPiiId, eventProducts, orderId, orderTime }) {
  try {
    const eventIsoTime = new Date(orderTime).toISOString();

    // We'll use a non-PII identifier for the profile ($id)
    const payload = {
      data: {
        type: 'event',
        attributes: {
          metric: {
            data: {
              type: 'metric',
              attributes: {
                name: 'Event Product Purchased', // A descriptive event name
              },
            },
          },
          // Updated (allowed):
          "profile": {
            "data": {
              "type": "profile",
              "attributes": {
                "external_id": "order_5845762638078"
              },
            },
          },
          properties: {
            event_products: eventProducts,
            order_id: orderId,
          },
          time: eventIsoTime,
        },
      },
    };

    console.log('Sending payload to Klaviyo:', JSON.stringify(payload, null, 2));

    await axios.post('https://a.klaviyo.com/api/events/', payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        revision: '2023-07-15',
      },
    });
    console.log('Tracked Klaviyo event for event products purchased.');
  } catch (error) {
    console.error(
      'Error tracking Klaviyo event:',
      JSON.stringify(error.response ? error.response.data : error.message, null, 2)
    );
    throw new Error('Failed to track Klaviyo event');
  }
}

// Function to add a note with event details to the Shopify order
async function addNoteToShopifyOrder({ orderId, eventProducts }) {
  try {
    const graphqlEndpoint = `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/graphql.json`;

    const notes = eventProducts
      .map((ep, idx) => {
        return [
          `Event ${idx + 1}: ${ep.title}`,
          `Address: ${ep.address}`,
          `Start: ${ep.start_date_time}`,
          `End: ${ep.end_date_time}`,
          `Refund Policy: ${ep.refund_policy}`,
          `Map Embed: ${ep.map_embed}`,
          `Calendar Embed: ${ep.calendar_embed}`
        ].join('\n');
      })
      .join('\n\n');

    console.log(`Adding note to Shopify order ${orderId}:\n${notes}`);

    const mutation = `
      mutation UpdateOrder($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        id: `gid://shopify/Order/${orderId}`,
        note: `Event Details:\n\n${notes}`,
      },
    };

    const response = await axios.post(
      graphqlEndpoint,
      { query: mutation, variables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
      }
    );

    const data = response.data;

    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      throw new Error('Failed to add note to Shopify order');
    }

    const userErrors = data.data.orderUpdate.userErrors;

    if (userErrors.length > 0) {
      console.error('User errors:', userErrors);
      throw new Error('Failed to add note to Shopify order');
    }

    console.log('Added event details to Shopify order notes.');
  } catch (error) {
    console.error(
      'Error adding note to Shopify order:',
      JSON.stringify(error.response ? error.response.data : error.message, null, 2)
    );
    throw new Error('Failed to add note to Shopify order');
  }
}
