const request = require("request-promise")
const express = require("express")

const app = express()

const lambdaEndpoint = process.env.LAMBDA_ENDPOINT

app.get("/hello", (req, res) => {
  // Query the example cloud function and return the response
  request.get(lambdaEndpoint)
    .then(response => {
      res.send(response)
    })
    .catch(() => {
      res.statusCode = 500
      res.json({error: "Unable to reach Lambda function at " + lambdaEndpoint})
    })
})

// This is the path GAE uses for health checks
app.get("/_ah/health", (req, res) => {
  res.sendStatus(200)
})

module.exports = { app }
