require('dotenv').config(); 
const express = require("express");
const app = express();
const path = require('path');
const stripe = require('stripe')(process.env.stripeKey);
const cors = require("cors");
const CookieParser = require("cookie-parser");
const DbConnection = require("../server/config/db");

const UserRouets = require("../server/modules/User/UserAuthRoutes");
const GenerateImage = require('./modules/ImageGenerate/GenerateimgRoute');
const GenerateVideo = require('./modules/VideoGenerate/VideoRoutes');
const GenerateFacelessVideo = require('./modules/FacelessVideoGeneration/FacelessVideoRoutes');
const Subscription = require('./modules/Subscription/SubscriptionRoute');
const errormiddleware = require("./middleware/error-middleware");
const { UserModel } = require("./models/UserModel");
const texttoscript = require('../server/modules/TexttoScript/Scriptroute')
app.use(cors({
  origin: 'http://localhost:5173', 
  credentials: true, 
}));

app.use(express.static(path.join(__dirname, 'public/VideoImages')));
app.use(CookieParser());

app.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  console.log('Raw request body:', req.body ? req.body.toString() : 'No raw body received');
  console.log('Headers:', req.headers);

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      Buffer.from(req.body),
      sig,
      endpointSecret
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      console.log('✅ Checkout session completed');

      const session = event.data.object;

      if (session.mode === 'subscription') {
        const subscriptionId = session.subscription;
        const stripeCustomerId = session.customer;

        try {
         
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await stripe.subscriptions.update(subscriptionId, {
            cancel_at: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days from now

          }); 
          const planId = subscription.items.data[0].price.id; // Get plan ID

          let imageGenerationLimit, videoGenerationLimit , facelessGenerationLimit , scriptGenerationLimit;
          switch (planId) {
            case process.env.STARTER_PLAN:
              imageGenerationLimit = 10;
              videoGenerationLimit = 3;
              scriptGenerationLimit = 3

              break;
            case process.env.PRO_PLAN:
              imageGenerationLimit = 50;
              videoGenerationLimit = 10;
              facelessGenerationLimit = 5
              scriptGenerationLimit = 10
              break;
            case process.env.ENTERPRISE_PLAN:
              imageGenerationLimit = 100;
              videoGenerationLimit = 20;
              facelessGenerationLimit = 20
              scriptGenerationLimit = 20
              break;
            default:
              imageGenerationLimit = 3;
              videoGenerationLimit = 1;
              facelessGenerationLimit = 0
              scriptGenerationLimit = 0
          }

          // Update user subscription details in MongoDB
          await UserModel.findOneAndUpdate(
            { stripeCustomerId },
            {
              subscriptionStatus: 'active',
              subscriptionPlan: planId,
              imageGenerationLimit,
              videoGenerationLimit,
              facelessGenerationLimit,
              scriptGenerationLimit,
              imageGenerationCount: 0,
              videoGenerationCount: 0,
              facelessGenerationLimit : 0,
              scriptGenerationLimit : 0
            }
          );

          console.log(`User subscription updated successfully for ${stripeCustomerId}`);
        } catch (error) {
          console.error(`Failed to retrieve subscription: ${error.message}`);
        }
      }
      break;

    case 'customer.subscription.deleted':
      console.log('Subscription deleted');

      const deletedSubscription = event.data.object;
      const deletedCustomerId = deletedSubscription.customer;

      // Correct update syntax
      await UserModel.findOneAndUpdate(
        { stripeCustomerId: deletedCustomerId },
        {
          subscriptionStatus: 'inactive',
          imageGenerationLimit: 0,
          videoGenerationLimit: 0,
          subscriptionPlan: null,
        }
      );

      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});


  app.use(express.urlencoded({ extended: true }));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));
app.use("/api/user", UserRouets);
app.use("/api/image", GenerateImage);
app.use("/api/video", GenerateVideo);
app.use('/api/facelessvideo', GenerateFacelessVideo);
app.use('/api/subscription', Subscription);
app.use('/api/text-to-script',texttoscript)

// Catch-all route to serve index.html for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});
app.use(errormiddleware);
DbConnection();
module.exports = app;
