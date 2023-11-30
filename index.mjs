import AWS from 'aws-sdk';
import axios from 'axios';
import { Storage } from '@google-cloud/storage';
import Mailgun from 'mailgun.js';
import formData from 'form-data';
import pulumi from '@pulumi/pulumi'
import aws from '@pulumi/aws';
import { SecretsManagerClient, GetSecretValueCommand, } from "@aws-sdk/client-secrets-manager";
const mailgun = new Mailgun(formData);

let GCP_client_email
let GCP_secretAccessKey
let emailStatus;
let trackEmails;
let emailErrorStatus;
let trackErrorEmails;
let response;
let secret;
let secretJson;


const DOMAIN=process.env.DOMAIN
const API_KEY=process.env.API_KEY
const GCP_SECRET_NAME=process.env.GCP_SECRET_NAME
const GCP_BUCKET_NAME=process.env.GCP_BUCKET_NAME
const DYNAMO_DB_TABLE=process.env.DYNAMO_DB_TABLE
const PROJECT_ID=process.env.PROJECT_ID

console.log(DOMAIN)
console.log(API_KEY)
console.log(GCP_SECRET_NAME)
console.log(GCP_BUCKET_NAME)
console.log(DYNAMO_DB_TABLE)

AWS.config.update({
    region: "us-east-1",
  });
  
  const client = new SecretsManagerClient({
    region: "us-east-1",
  });
  
  try {
        response = await client.send(
        new GetSecretValueCommand({
            SecretId: process.env.GCP_SECRET_NAME,
            VersionStage: "AWSCURRENT",    }));
  } catch (error) {
        console.log(error);
        throw error;
  }
  try{
        if (response.SecretString) {
            secret = response.SecretString;
        } else if (response.SecretBinary) {
            // Convert the Uint8Array to a Buffer, then to a string
            const secretBinary = Buffer.from(response.SecretBinary);
            secret = secretBinary.toString('utf-8');
  }} catch (error) {
            console.log(error);
            throw error;
  }

try {
        secretJson = JSON.parse(secret);
        console.log("Secret as JSON:", secretJson);
} catch (error) {
        console.error("Error parsing secret string to JSON:", error);
        throw error;
}

GCP_client_email=secretJson.client_email
GCP_secretAccessKey=secretJson.private_key


const dynamoDB = new AWS.DynamoDB();

const storage = new Storage({
    projectId: PROJECT_ID,
    credentials: {
      client_email: GCP_client_email,
      private_key:GCP_secretAccessKey
    },
  });
  
  let message;
  let userEmail;
  let submissionUrl;
  let user_name;
  let user_id;
  let assignment_id;
  let submission_id;

export const handler = async (event) => {
        console.log("SNS Message:", event.Records[0].Sns.Message);

         message = JSON.parse(event.Records[0].Sns.Message);
         console.log(message)
         userEmail = message.userEmail;
         submissionUrl = message.submissionUrl;
         user_name=message.user_name
         user_id=message.user_id
         assignment_id=message.assignmentId
         submission_id=message.submission_id;


         try{
            let headResponse;
            try {
                headResponse = await axios.head(submissionUrl);
                if (headResponse.status !== 200) {
                    const errorMsg = 'Submission URL is not reachable';
                    logger.error(`API Assignments - ${errorMsg}`);
                    await sendErrorEmail(DOMAIN, userEmail, user_name, errorMsg);
                    return;
                }
                headResponse = await axios.get(submissionUrl);
                // Check if the file at the URL has a non-zero payload
                const contentLength = headResponse.headers['content-length'];
                if (!contentLength || parseInt(contentLength, 10) === 0) {
                    const errorMsg = 'The file at the URL has a 0-byte payload';
                    logger.error(`API Assignments - ${errorMsg}`);
                    await sendErrorEmail(DOMAIN, userEmail, user_name, errorMsg);
                    return;
                }
            } catch (err) {
                // Handle other errors (e.g., network issues, invalid URL format, etc.)
                const errorMsg = `Error when validating submission URL: ${err.message}`;
                logger.error(`API Assignments - ${errorMsg}`);
                await sendErrorEmail(DOMAIN, userEmail, user_name, errorMsg);
                return;
            }
    }catch(err){
        console.log(err)

    }
         try {
                console.log('In try')
                const githubReleaseUrl = submissionUrl;
                const releaseResponse = await axios.get(githubReleaseUrl, { responseType: 'arraybuffer' });
                const releaseData = Buffer.from(releaseResponse.data);

                const bucketName = GCP_BUCKET_NAME;
                const fileName = `release-${Date.now()}.zip`;
                const filePath = `user_${user_id}/assignment_${assignment_id}/${Date.now()}_release.zip`;
                const bucket = storage.bucket(bucketName);
                const file = bucket.file(filePath);
                await file.save(releaseData);

      emailStatus = await sendEmail(DOMAIN, userEmail, user_name, submissionUrl, filePath, fileName);
      console.log('IN tryyy after email Status')
      console.log('email status', emailStatus)
      // }
      // Track emails sent in DynamoDB
       trackEmails = await trackEmailInDynamoDB(emailStatus, userEmail);
       console.log('IN tryyy after trackEmails')
       console.log('email status', trackEmails)
  
      return 'Success';
    } catch (error) {
      console.error('Error:', error);
      emailErrorStatus = await sendErrorEmail(DOMAIN, userEmail, user_name,error);
      console.log('INfirst catch after emailErrorStatus')
      console.log('email status', emailErrorStatus)
      trackErrorEmails = await trackEmailInDynamoDB( emailErrorStatus, userEmail);
      throw error; // Propagate the error to be logged in CloudWatch
    }
  };

    async function trackEmailInDynamoDB(emailStatus, userEmail) {

        console.log('In traj=kibgvgggggg')
        console.log(emailStatus)
                  const dynamoDBParams = {
                  TableName: DYNAMO_DB_TABLE,
                  Item: {
                    submissionId: { S: submission_id.toString() },
                    userId: { S: user_id.toString() },
                    email: { S: userEmail },
                    assignmentId: { S: assignment_id.toString() },
                    emailStatus: { S: emailStatus },
                    timestamp: { S: Date.now().toString() }
                  },}
                  console.log(submission_id.toString())
                  console.log(user_id.toString())
                  console.log(userEmail)
                  console.log(assignment_id.toString())
                  console.log(Date.now().toString())
                  console.log(emailStatus)
                  console.log(dynamoDBParams)
                  try {
                    const trackEmails = await dynamoDB.putItem(dynamoDBParams).promise();
                    console.log('Email tracked:', trackEmails);
                    return 'Email tracked successfully';
                  } catch (err) {
                    console.error('Error tracking email:', err);
                    throw err;
                  }
                }

 

    async function sendEmail(domainName, userEmail, user_name, submissionUrl, filePath, fileName) {

        console.log('Inside +ve');
        const client = mailgun.client({ username: 'api', key: API_KEY });
    
        const body = `Hi ${user_name},\n\nHere is the status of your download.\n\nThe file ${fileName} and this is the path ${filePath}`;
        const from = `mailgun@${DOMAIN}`;;
         
        const messageData = {
            from: 'Neha <mailgun@nehadevhub.me>',
            to: userEmail,
            subject: 'Status of your Submission',
            text: body
        };
        
        try {
            const response = await client.messages.create(domainName, messageData);
            console.log('+ve Email sent:', response);
            return 'Email sent successfully';
          } catch (err) {
            console.error('+ve Error sending  email:', err);
            throw err;
          }
        // }
    }

    async function sendErrorEmail(domainName, email, name,errorMessage) {
        console.log('Inside sendErrorEmail');
        const client = mailgun.client({ username: 'api', key: API_KEY });
    
        const body = `Hi ${name},\n\nThere was an error processing your submission.\n\n ${errorMessage}\n\nThankyou\nCloudCanvas`;
        const from = `mailgun@${DOMAIN}`;;
         
        const messageData = {
            from: 'Neha <mailgun@nehadevhub.me>',
            to: email,
            subject: 'Error Processing your Submission',
            text: body
        };
        
        try {
            const response = await client.messages.create(domainName, messageData);
            console.log('Error Email sent:', response);
            return 'Error Email sent successfully';
          } catch (err) {
            console.error('Error sending error email:', err);
            throw err;
          }

    }
    


