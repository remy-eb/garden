import * as AWS from "aws-sdk"
import * as s3 from "s3"

function getS3Client(s3Options: AWS.S3.Types.ClientConfiguration) {
  const awsS3Client = new AWS.S3(s3Options)
  return s3.createClient({
    s3Client: awsS3Client,
  })
}

export async function uploadToS3(
  s3Options: AWS.S3.Types.ClientConfiguration, localPath: string, bucket: string, key: string,
) {
  const client = getS3Client(s3Options)

  const params = {
    localFile: localPath,

    s3Params: {
      Bucket: bucket,
      Key: key,
    },
  }

  const uploader = client.uploadFile(params)

  return new Promise((resolve, reject) => {
    uploader.on("error", function(err) {
      reject(err)
    })
    // uploader.on("progress", function() {
    //   console.log("progress", uploader.progressMd5Amount,
    //     uploader.progressAmount, uploader.progressTotal)
    // })
    uploader.on("end", function() {
      resolve()
    })
  })
}
