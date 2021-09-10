FROM node:14.16.1-alpine3.13

# Create app directory
WORKDIR /usr/src/app/

COPY . .

RUN yarn install --frozen

# Run Node app as child of tini
# Signal handling for PID1 https://github.com/krallin/tini
RUN apk add --no-cache tini
# Tini is now available at /sbin/tini
ENTRYPOINT ["/sbin/tini", "--"]
