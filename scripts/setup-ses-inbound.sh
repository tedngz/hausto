#!/usr/bin/env bash
# Wire inbound mail for hello@hausto.com into the concierge-email-inbound edge
# function: SES receipt rule -> SNS topic -> HTTPS subscription.
#
# Prerequisites: AWS CLI configured (`aws configure`) with permissions for
# ses:*ReceiptRule*, sns:CreateTopic/Subscribe/SetTopicAttributes, sts:GetCallerIdentity.
#
# Usage: CONCIERGE_INBOUND_SECRET=<secret> bash scripts/setup-ses-inbound.sh
# The secret is the value stored in Supabase; it is never written to this repo.
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-1}"   # must match the MX host for hausto.com
DOMAIN="hausto.com"
RECIPIENT="hello@hausto.com"
TOPIC_NAME="hausto-concierge-inbound"
RULE_NAME="concierge-to-sns"
FUNCTION_URL="https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/concierge-email-inbound"

SECRET="${CONCIERGE_INBOUND_SECRET:-}"
if [ -z "$SECRET" ]; then
  echo "Set CONCIERGE_INBOUND_SECRET to the value stored in Supabase, then re-run." >&2
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS account ${ACCOUNT_ID}, region ${REGION}"

# SES will not accept mail for a domain it has not verified for receiving.
VERIFIED=$(aws ses get-identity-verification-attributes --identities "$DOMAIN" --region "$REGION" \
  --query "VerificationAttributes.\"${DOMAIN}\".VerificationStatus" --output text 2>/dev/null || echo "None")
if [ "$VERIFIED" != "Success" ]; then
  echo "WARNING: ${DOMAIN} is not a verified SES identity in ${REGION} (status: ${VERIFIED})."
  echo "         Inbound mail will bounce until it is verified."
fi

# create-topic is idempotent - it returns the existing ARN if the topic is there.
TOPIC_ARN=$(aws sns create-topic --name "$TOPIC_NAME" --region "$REGION" --output text --query TopicArn)
echo "Topic: ${TOPIC_ARN}"

aws sns set-topic-attributes --region "$REGION" --topic-arn "$TOPIC_ARN" \
  --attribute-name Policy --attribute-value "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Principal\": { \"Service\": \"ses.amazonaws.com\" },
    \"Action\": \"sns:Publish\",
    \"Resource\": \"${TOPIC_ARN}\",
    \"Condition\": { \"StringEquals\": { \"AWS:SourceAccount\": \"${ACCOUNT_ID}\" } }
  }]
}"
echo "Topic policy set (SES may publish)."

aws sns subscribe --region "$REGION" --topic-arn "$TOPIC_ARN" \
  --protocol https --notification-endpoint "${FUNCTION_URL}?secret=${SECRET}" >/dev/null
echo "Subscription requested (pending confirmation)."

# Reuse the active rule set if there is one: activating a new set silently
# disables whatever was already handling mail for this domain.
RULE_SET=$(aws ses describe-active-receipt-rule-set --region "$REGION" \
  --query "Metadata.Name" --output text 2>/dev/null || echo "None")
if [ "$RULE_SET" = "None" ] || [ -z "$RULE_SET" ]; then
  RULE_SET="hausto-inbound"
  aws ses create-receipt-rule-set --region "$REGION" --rule-set-name "$RULE_SET" 2>/dev/null || true
  aws ses set-active-receipt-rule-set --region "$REGION" --rule-set-name "$RULE_SET"
  echo "Created and activated rule set ${RULE_SET}."
else
  echo "Reusing active rule set ${RULE_SET}."
fi

# SNSAction inlines the message (~150KB ceiling), which is what the function parses.
aws ses create-receipt-rule --region "$REGION" --rule-set-name "$RULE_SET" --rule "{
  \"Name\": \"${RULE_NAME}\",
  \"Enabled\": true,
  \"TlsPolicy\": \"Optional\",
  \"ScanEnabled\": true,
  \"Recipients\": [\"${RECIPIENT}\"],
  \"Actions\": [{ \"SNSAction\": { \"TopicArn\": \"${TOPIC_ARN}\", \"Encoding\": \"UTF-8\" } }]
}" 2>/dev/null || echo "Rule ${RULE_NAME} already exists - leaving it as is."

echo
echo "Done except for the subscription handshake."
echo "SNS has POSTed a SubscriptionConfirmation to the function, which logs the"
echo "token rather than following the link. Open Supabase -> Edge Functions ->"
echo "concierge-email-inbound -> Logs, copy the Token, then run:"
echo
echo "  aws sns confirm-subscription --region ${REGION} --topic-arn ${TOPIC_ARN} --token <TOKEN>"
echo
echo "Check status with:"
echo "  aws sns list-subscriptions-by-topic --region ${REGION} --topic-arn ${TOPIC_ARN}"
