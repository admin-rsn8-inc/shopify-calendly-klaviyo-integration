// scripts/subscribe-webhook.js

const axios = require('axios');

const SHOP_NAME = process.env.SHOP_NAME;
const ADMIN_API_ACCESS_TOKEN = process.env.ADMIN_API_ACCESS_TOKEN;
const WEBHOOK_ADDRESS = process.env.WEBHOOK_ADDRESS;
const WEBHOOK_TOPIC = 'ORDERS_CREATE'; // GraphQL Enum value

async function subscribeToWebhook() {
  console.log('Starting webhook subscription process...');
  console.log('Shop Name:', SHOP_NAME);
  console.log('Webhook Address:', WEBHOOK_ADDRESS);
  console.log('Webhook Topic:', WEBHOOK_TOPIC);

  const endpoint = `https://${SHOP_NAME}.myshopify.com/admin/api/2023-10/graphql.json`;

  // Query to get existing webhook subscriptions
  const checkQuery = `
    {
      webhookSubscriptions(first: 100) {
        edges {
          node {
            id
            callbackUrl
            topic
          }
        }
      }
    }
  `;

  try {
    // Fetch existing webhook subscriptions
    const checkResponse = await axios.post(
      endpoint,
      { query: checkQuery },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
      }
    );

    const responseData = checkResponse.data;

    // Check for errors in the response
    if (responseData.errors && responseData.errors.length > 0) {
      console.error('GraphQL Errors:', JSON.stringify(responseData.errors, null, 2));
      return;
    }

    if (!responseData.data) {
      console.error('No data returned from API.');
      return;
    }

    const webhooks = responseData.data.webhookSubscriptions.edges;

    // Filter webhooks to find if our webhook already exists
    const webhookExists = webhooks.some(
      webhook =>
        webhook.node.callbackUrl === WEBHOOK_ADDRESS && webhook.node.topic === WEBHOOK_TOPIC
    );

    if (webhookExists) {
      console.log('Webhook subscription already exists.');
      return;
    }

    console.log('No existing webhook found. Creating a new webhook subscription...');

    // Mutation to create the webhook subscription
    const createQuery = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: {callbackUrl: $callbackUrl}) {
          userErrors {
            field
            message
          }
          webhookSubscription {
            id
            topic
            callbackUrl
          }
        }
      }
    `;

    const createVariables = {
      topic: WEBHOOK_TOPIC,
      callbackUrl: WEBHOOK_ADDRESS,
    };

    const createResponse = await axios.post(
      endpoint,
      { query: createQuery, variables: createVariables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
      }
    );

    const createData = createResponse.data;

    if (createData.errors && createData.errors.length > 0) {
      console.error('GraphQL Errors:', JSON.stringify(createData.errors, null, 2));
    } else if (createData.data.webhookSubscriptionCreate.userErrors.length > 0) {
      console.error(
        'User Errors:',
        JSON.stringify(createData.data.webhookSubscriptionCreate.userErrors, null, 2)
      );
    } else {
      console.log(
        'Webhook subscription created successfully:',
        JSON.stringify(createData.data.webhookSubscriptionCreate.webhookSubscription, null, 2)
      );
    }

    console.log('Webhook subscription process completed.');
  } catch (error) {
    console.error(
      'Error subscribing to webhook:',
      error.response ? JSON.stringify(error.response.data, null, 2) : error.message
    );
  }
}

subscribeToWebhook();
