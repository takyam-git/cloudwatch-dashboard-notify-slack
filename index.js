const AWS = require('aws-sdk')
const mergeImg = require('merge-img')
const source = require('./source.json')
const Jimp = require('jimp')
const _ = require('lodash')
const {WebClient} = require('@slack/web-api')

const slackToken = process.env.SLACK_APP_TOKEN
const slackChannelId = process.env.SLACK_CHANNEL_ID
if (!slackToken || !slackChannelId) {
  throw new Error('token or slack channel id does not set')
}

const dashboardUrl = process.env.CLOUDWATCH_DASHBOARD_URL || ''
const slackWeb = new WebClient(slackToken)

async function main() {
  const cloudwatch = new AWS.CloudWatch()

  const promises = source.widgets.map(async props =>
    cloudwatch
    .getMetricWidgetImage({
      OutputFormat: 'png',
      MetricWidget: JSON.stringify({
        ...props.properties,
        start: '-P14D',
        timezone: '+0900'
      })
    })
    .promise()
  )
  const imageBuffers = (await Promise.all(promises))
  .map(result => result.MetricWidgetImage)

  const chunked = _.chunk(imageBuffers, 5)
  const rowMergesPromises = Promise.all(chunked.map(images => new Promise(resolve => {
    if (images.length === 1) {
      resolve(images[0])
      return
    }
    mergeImg(images).then(merged => {
      merged.getBuffer(Jimp.MIME_PNG, async (err, buffer) => {
        if (err) {
          throw new Error(err)
        }
        resolve(buffer)
      })
    })
  })))
  const rowMerged = await rowMergesPromises
  const merged = await mergeImg(rowMerged, {direction: true})

  const buffer = new Promise(((resolve, reject) => {
    merged.getBuffer(Jimp.MIME_PNG, (err, buffer) => {
      if (err) {
        reject(err)
        return
      }
      resolve(buffer)
    })
  }))
  await slackWeb.files.upload({
    channels: slackChannelId,
    file: await buffer,
    filename: (new Date()).toLocaleTimeString(),
    title: (new Date()).toLocaleTimeString(),
    filetype: 'image/png',
    initial_comment: dashboardUrl
  })

  return {
    statusCode: 200,
    body: JSON.stringify('succeed'),
  }
}

const run = async () => {
  return new Promise((resolve, reject) => {
    AWS.config.getCredentials(async function (err) {
      if (err) {
        // credentials not loaded
        reject(err)
        return
      }
      AWS.config.update({region: 'ap-northeast-1'})
      resolve(await main())
    })
  })
}

exports.handler = run
