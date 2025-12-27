#!/bin/sh

# Replace placeholders in nginx.conf
envsubst '${GEMINI_API_KEY} ${LLM_MODEL_NAME} ${HIDE_CHARTDB_CLOUD} ${DISABLE_ANALYTICS}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# Start Nginx
nginx -g "daemon off;"
