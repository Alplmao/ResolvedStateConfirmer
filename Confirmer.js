const axios = require('axios');
const nodemailer = require('nodemailer');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

const organization = 'berkealpertugrul';
const project = 'SupportResolvedConfirmation';
const personalAccessToken = 'dle4tcdy4ovf6xwezhsn73yeu2pazh2fbj6dirzqj2sylwkglp6a'; // Azure DevOps Personal Access Token

const emailService = 'gmail';
const emailUser = 'resolvedstateconfirmation@gmail.com';
const emailPass = 'qfyx pork xgal utsi'; // Ensure this is correct and secure

// Path to store the list of sent work items
const sentWorkItemsFile = path.join(__dirname, 'sentWorkItems.json');

// Create an instance of axios with the base URL and authentication headers for WIQL queries
const wiqlInstance = axios.create({
    baseURL: `https://dev.azure.com/${organization}/${project}/_apis/wit/wiql?api-version=6.0`,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(':' + personalAccessToken).toString('base64')}`
    }
});

// Function to read sent work items from file
function readSentWorkItems() {
    if (fs.existsSync(sentWorkItemsFile)) {
        const data = fs.readFileSync(sentWorkItemsFile);
        return JSON.parse(data);
    }
    return {};
}

// Function to write sent work items to file
function writeSentWorkItems(sentWorkItems) {
    fs.writeFileSync(sentWorkItemsFile, JSON.stringify(sentWorkItems, null, 2));
}

// Function to fetch work item IDs, email addresses, and titles using WIQL
async function fetchWorkItemEmails() {
    const wiqlQuery = ` 
    SELECT [System.Id], [System.Title], [Custom.Requester]
    FROM WorkItems
    WHERE [System.State] = 'Resolved'
    `;

    try {
        const response = await wiqlInstance.post('', { query: wiqlQuery });
        const workItems = response.data.workItems;

        // Fetch detailed work item info including email addresses and titles
        const detailedWorkItems = await Promise.all(workItems.map(async item => {
            const workItemResponse = await axios.get(`https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/${item.id}?api-version=6.0`, {
                headers: {
                    'Authorization': `Basic ${Buffer.from(':' + personalAccessToken).toString('base64')}`
                }
            });
            return {
                id: item.id,
                title: workItemResponse.data.fields['System.Title'],
                email: workItemResponse.data.fields['Custom.Requester'] ? workItemResponse.data.fields['Custom.Requester'].uniqueName : 'No email'
            };
        }));

        console.log('Fetched Work Items with Emails and Titles:', detailedWorkItems);
        return detailedWorkItems;
    } catch (error) {
        console.error('Error fetching work item emails:', error.response ? error.response.data : error.message);
        return [];
    }
}

// Function to send confirmation email
async function sendConfirmationEmail(workItem) {
    const yesLink = `http://localhost:1337/confirm?workItemId=${workItem.id}&status=closed`;
    const noLink = `http://localhost:1337/confirm?workItemId=${workItem.id}&status=notresolved`;

    const transporter = nodemailer.createTransport({
        service: emailService,
        auth: {
            user: emailUser,
            pass: emailPass
        }
    });

    const mailOptions = {
        from: emailUser,
        to: workItem.email,
        subject: `Confirmation Required: ${workItem.title}`,
        html: `
            <p>Please confirm if the issue with "${workItem.title}" (Feature #${workItem.id}) is resolved by clicking one of the buttons below:</p>
            <a href="${yesLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-align: center; text-decoration: none; display: inline-block; border-radius: 5px;">
                Yes
            </a>
            <a href="${noLink}" style="background-color: #f44336; color: white; padding: 10px 20px; text-align: center; text-decoration: none; display: inline-block; border-radius: 5px; margin-left: 10px;">
                No
            </a>
            <p>Thank you!</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Confirmation email sent to ${workItem.email} for Feature #${workItem.id}: ${workItem.title}`);
    } catch (error) {
        console.error(`Error sending email to ${workItem.email} for Feature #${workItem.id}:`, error.message);
    }
}

// Function to update the state of work items to 'Closed' and add a confirmation description
async function updateWorkItemStateToClosed(workItemId, email) {
    const workItemInstance = axios.create({
        baseURL: `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems`,
        headers: {
            'Content-Type': 'application/json-patch+json',
            'Authorization': `Basic ${Buffer.from(':' + personalAccessToken).toString('base64')}`
        }
    });

    const updatePayload = [
        {
            op: 'add',
            path: '/fields/System.State',
            value: 'Closed' // New state
        }
    ];

    try {
        const response = await workItemInstance.patch(`/${workItemId}?api-version=6.0`, updatePayload);
        console.log(`Feature #${workItemId} updated to Closed with confirmation from ${email}:`, response.data);
    } catch (error) {
        console.error(`Error updating Feature #${workItemId} to Closed:`, error.response ? error.response.data : error.message);
    }
}

// Function to handle confirmation URL
async function handleConfirmationRequest(req, res) {
    const { workItemId, status } = req.query;

    try {
        // Fetch work item details to get the email
        const workItemResponse = await axios.get(`https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/${workItemId}?api-version=6.0`, {
            headers: {
                'Authorization': `Basic ${Buffer.from(':' + personalAccessToken).toString('base64')}`
            }
        });

        const email = workItemResponse.data.fields['Custom.Requester'] ? workItemResponse.data.fields['Custom.Requester'].uniqueName : 'No email';
        const title = workItemResponse.data.fields['System.Title'];

        if (status === 'closed') {
            await updateWorkItemStateToClosed(workItemId, email);
            await addCommentToWorkItem(workItemId, `Feature #${workItemId}:${title} marked as Closed. Confirmation received from ${email}.`, email);
            res.send(`Feature #${workItemId}: ${title} has been marked as Closed.`);

            // Update sentWorkItems status to 'closed'
            const sentWorkItems = readSentWorkItems();
            if (sentWorkItems[workItemId]) {
                sentWorkItems[workItemId].status = 'closed';
                writeSentWorkItems(sentWorkItems);
            }
        } else if (status === 'notresolved') {
            // Mark the status as 'notresolved'
            await addCommentToWorkItem(workItemId, `Feature #${workItemId}:${title} is not resolved. Confirmation received from ${email}.`, email);
            res.send(`A comment has been added to Feature #${workItemId}: ${title} stating that the issue is not resolved.`);

            // Update sentWorkItems status
            const sentWorkItems = readSentWorkItems();
            if (sentWorkItems[workItemId]) {
                sentWorkItems[workItemId].status = 'notresolved';
                writeSentWorkItems(sentWorkItems);
            }
        } else {
            res.send(`Invalid status for Feature #${workItemId}.`);
        }
    } catch (error) {
        console.error(`Error handling confirmation request for Feature #${workItemId}:`, error.message);
        res.send(`An error occurred: ${error.message}`);
    }
}


async function addCommentToWorkItem(workItemId, comment, email) {
    const workItemInstance = axios.create({
        baseURL: `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems`,
        headers: {
            'Content-Type': 'application/json-patch+json',
            'Authorization': `Basic ${Buffer.from(':' + personalAccessToken).toString('base64')}`
        }
    });

    const updatePayload = [
        {
            op: 'add',
            path: '/fields/System.History',
            value: comment
        }
    ];

    try {
        // Update the work item with the comment
        const response = await workItemInstance.patch(`/${workItemId}?api-version=6.0`, updatePayload);
        console.log(`Comment added to Feature #${workItemId}:`, response.data);

        // Send the comment via email
        await sendCommentEmail(workItemId, comment, email);
    } catch (error) {
        console.error(`Error adding comment to Feature #${workItemId}:`, error.response ? error.response.data : error.message);
    }
}

async function sendCommentEmail(workItemId, comment, email) {
    const transporter = nodemailer.createTransport({
        service: emailService,
        auth: {
            user: emailUser,
            pass: emailPass
        }
    });

    const mailOptions = {
        from: emailUser,
        to: 'berkealpertugrul@gmail.com', //yazilimgelistirme@wagner.com.tr
        subject: `Feature #${workItemId} Comment`,
        text: `Comment for feature #${workItemId}:\n\n${comment}`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Comment email sent for Feature #${workItemId}`);
    } catch (error) {
        console.error(`Error sending comment email for Feature #${workItemId}:`, error.message);
    }
}


async function checkForAutoClose() {
    const sentWorkItems = readSentWorkItems();
    console.log('Checking for auto-close. Current work items:', sentWorkItems);

    for (const [workItemId, { sentAt, status }] of Object.entries(sentWorkItems)) {
        const sentTime = new Date(sentAt).getTime();
        const currentTime = Date.now();

        console.log(`Checking work item #${workItemId}: Sent at ${sentAt}, Status ${status}`);

        // Skip items that are already closed
        if (status === 'closed') {
            console.log(`Work item #${workItemId} is already closed. Skipping.`);
            continue;
        }

        if ((currentTime - sentTime) >= (1 * 1 * 40 * 1000)) { // 48 saat 48 * 60 * 60 * 1000
            if (status === 'pending') {
                console.log(`Work item #${workItemId} has reached 48 hours. Auto-closing.`);
                await updateWorkItemStateToClosed(workItemId, sentWorkItems[workItemId].email);
                await addCommentToWorkItem(workItemId, `The 48-hour time limit has passed. Feature #${workItemId} has been auto-closed.`, sentWorkItems[workItemId].email);

                // Update the status to 'closed' and remove the item from tracking
                sentWorkItems[workItemId].status = 'closed';
                delete sentWorkItems[workItemId];
            }
        }
    }

    // Write updated status to file
    writeSentWorkItems(sentWorkItems);
}





async function pollWorkItems() {
    const workItems = await fetchWorkItemEmails();
    const sentWorkItems = readSentWorkItems();

    for (const workItem of workItems) {
        if (!sentWorkItems[workItem.id]) {
            await sendConfirmationEmail(workItem);
            sentWorkItems[workItem.id] = { sentAt: new Date().toISOString(), email: workItem.email, status: 'pending' };
        }
    }

    writeSentWorkItems(sentWorkItems);

    // Call async function checkForAutoClose
    await checkForAutoClose();
}


setInterval(pollWorkItems, 1 * 10 * 1000); // 5 dakika 5*60*1000


app.get('/confirm', async (req, res) => {
    await handleConfirmationRequest(req, res);
});


const port = 1337;
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});



//cd C:\Users\support\source\repos\NodeJSConsole\NodeJSConsole