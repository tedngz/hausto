UPDATE subscribers 
SET subscribed = false, subscription_tier = 'free', updated_at = now()
WHERE subscribed = true 
  AND subscription_tier = 'premium' 
  AND paypal_subscription_id IS NULL;