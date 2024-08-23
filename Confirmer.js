const axios = require('axios');
const nodemailer = require('nodemailer');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

const organization = 'berkealpertugrul';
const project = 'SupportResolvedConfirmation';
const personalAccessToken = 'dle4tcdy4ovf6xwezhsn73yeu2pazh2fbj6dirzqj2sylwkglp6a'; // Azure DevOps Personal Access Token irm5//u7obfhu37u4mmk77cxbjfecq//fmrmssp25a2btv5l5jqt3kga yeni token

const emailService = 'gmail';
const emailUser = 'resolvedstateconfirmation@gmail.com';
const emailPass = 'qfyx pork xgal utsi'; //gmail app passkey


const sentWorkItemsFile = path.join(__dirname, 'sentWorkItems.json');


const wiqlInstance = axios.create({
    baseURL: `https://dev.azure.com/${organization}/${project}/_apis/wit/wiql?api-version=6.0`,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(':' + personalAccessToken).toString('base64')}`
    }
});


function readSentWorkItems() {                              //readSentWorkItems  ve writeSentWorkItems sentworkitems.json dosyasını okuyor, sentworkitems.json dosyası 5 dakikada bir mail atıldığında aynı maili birden fazla atmayı önlüyor, aynı zamanda 48 saat sonra kapanması için tarih tutuyor.
    if (fs.existsSync(sentWorkItemsFile)) {
        const data = fs.readFileSync(sentWorkItemsFile);
        return JSON.parse(data);
    }
    return {};
}


function writeSentWorkItems(sentWorkItems) {
    fs.writeFileSync(sentWorkItemsFile, JSON.stringify(sentWorkItems, null, 2));
}


async function fetchWorkItemEmails() {                   //resolved olan bütün work itemların idlerini,isimlerini ve "requester" olarak ismini değiştirdiğim optional attendee 1'i çağırıyor.
    const wiqlQuery = `                                  
    SELECT [System.Id], [System.Title], [Custom.Requester]
    FROM WorkItems
    WHERE [System.State] = 'Resolved'
    `;
    //not: optional attendee 1 mi yoksa başka bir şey mi hatırlamıyorum

    try {
        const response = await wiqlInstance.post('', { query: wiqlQuery });
        const workItems = response.data.workItems;

        
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


async function sendConfirmationEmail(workItem) {  //confirmation emaillerini gönderen method
    const yesLink = `http://localhost:1337/confirm?workItemId=${workItem.id}&status=closed`;
    const noLink = `http://localhost:1337/confirm?workItemId=${workItem.id}&status=notresolved`;

    const transporter = nodemailer.createTransport({     //mail göndermek için nodemailer kullandım, gmailden app passkey çıkartmadan çalışmıyor
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


async function updateWorkItemStateToClosed(workItemId, email) { //work item ı closed olarak işaretliyor.
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
            value: 'Closed' 
        }
    ];

    try {
        const response = await workItemInstance.patch(`/${workItemId}?api-version=6.0`, updatePayload);
        console.log(`Feature #${workItemId} updated to Closed with confirmation from ${email}:`, response.data);
    } catch (error) {
        console.error(`Error updating Feature #${workItemId} to Closed:`, error.response ? error.response.data : error.message);
    }
}


async function handleConfirmationRequest(req, res) {  //work itemlara comment ekliyor ve json file'ı güncelliyor
    const { workItemId, status } = req.query;

    try {
       
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

            
            const sentWorkItems = readSentWorkItems();
            if (sentWorkItems[workItemId]) {
                sentWorkItems[workItemId].status = 'closed';
                writeSentWorkItems(sentWorkItems);
            }
        } else if (status === 'notresolved') {
            
            await addCommentToWorkItem(workItemId, `Feature #${workItemId}:${title} is not resolved. Confirmation received from ${email}.`, email);
            res.send(`A comment has been added to Feature #${workItemId}: ${title} stating that the issue is not resolved.`);

            
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


async function addCommentToWorkItem(workItemId, comment, email) { //comment i eklemek için kullandığımız method
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
        
        const response = await workItemInstance.patch(`/${workItemId}?api-version=6.0`, updatePayload);
        console.log(`Comment added to Feature #${workItemId}:`, response.data);

        
        await sendCommentEmail(workItemId, comment, email);
    } catch (error) {
        console.error(`Error adding comment to Feature #${workItemId}:`, error.response ? error.response.data : error.message);
    }
}

async function sendCommentEmail(workItemId, comment, email) { //work item a yazılan comment i bize de yollayan method
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


async function checkForAutoClose() { //json file ı okuyor ve work itemları 48 saat içinde kapanmalarını sağlıyor, test için 40 saniyede kapanıyor. 48 saat için 48*60*60*1000 olarak değiştirin.
    const sentWorkItems = readSentWorkItems();
    console.log('Checking for auto-close. Current work items:', sentWorkItems);

    for (const [workItemId, { sentAt, status }] of Object.entries(sentWorkItems)) {
        const sentTime = new Date(sentAt).getTime();
        const currentTime = Date.now();

        console.log(`Checking work item #${workItemId}: Sent at ${sentAt}, Status ${status}`);

        
        if (status === 'closed') {
            console.log(`Work item #${workItemId} is already closed. Skipping.`);
            continue;
        }

        if ((currentTime - sentTime) >= (1 * 1 * 40 * 1000)) { // 48 saat 48 * 60 * 60 * 1000
            if (status === 'pending') {
                console.log(`Work item #${workItemId} has reached 48 hours. Auto-closing.`);
                await updateWorkItemStateToClosed(workItemId, sentWorkItems[workItemId].email);
                await addCommentToWorkItem(workItemId, `The 48-hour time limit has passed. Feature #${workItemId} has been auto-closed.`, sentWorkItems[workItemId].email);

                
                sentWorkItems[workItemId].status = 'closed';
                delete sentWorkItems[workItemId];
            }
        }
    }

    
    writeSentWorkItems(sentWorkItems);
}





async function pollWorkItems() { //5 dakikada bir resolved emailleri ve otomatik olarak kapanması gereken emailleri kontrol ediyor , test için 10 saniyeye ayarlı
    const workItems = await fetchWorkItemEmails();
    const sentWorkItems = readSentWorkItems();

    for (const workItem of workItems) {
        if (!sentWorkItems[workItem.id]) {
            await sendConfirmationEmail(workItem);
            sentWorkItems[workItem.id] = { sentAt: new Date().toISOString(), email: workItem.email, status: 'pending' };
        }
    }

    writeSentWorkItems(sentWorkItems);

    
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
