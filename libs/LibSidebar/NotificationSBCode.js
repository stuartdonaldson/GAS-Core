/**
 * Description: Code for the Notification Sidebar
 * 
 * This script provides functionality for displaying notifications in a sidebar within Google Sheets.
 * It includes functions for initializing the sidebar, logging messages, creating prompts, and handling
 * client-server communication through script properties.
 * 
 * Note: This is part of GApps/LibSidebar, which is where the authoritative copy of this is maintained.
 */
  
// Test function to populate the sidebar with different types of messages
function testNotificationSidebar() {
  NoticeLogInit( `Testing Notification Sidebar`, 
                `This tests the notification sidebar functionality 
                showing a title, <b>description</b>, log messages, and a 
                prompt for response.` );
  NoticeLog( "progress step 1" );
  NoticeLog( "-" );
  Utilities.sleep(2000);
  NoticeLog( "progress step 2" );
  Utilities.sleep(2000);
  NoticeLog( "progress step 3" );
  Utilities.sleep(2000);

  NoticeLog(`Click ${blf("here", "https://example.com")} to access the link`);
  Utilities.sleep(2000);

  var x = NoticePrompt( "Enter your name", "Please enter your name:" );
  NoticeLog( "You entered " + x );
  Utilities.sleep(2000);
  NoticeLog( "Test complete" ); 
}

  
// blf( text, link ) - create a link in the sidebar
function blf( text, link ) { 
  // construct an html hyperlink
  return '<a href="' + link + '" target="_blank">' + text + '</a>';
}

  // NoticeLogInit - creates a new sidebar, initializing the log and creating a description area
function NoticeLogInit( title, desc ) {
  var messages = {
    title: title,
    desc: desc,
    log: null,
    prompt: null,
    response: null,
  };
  // Function to show the sidebar
  var html = HtmlService.createHtmlOutputFromFile('NotificationSidebar');
  SpreadsheetApp.getUi().showSidebar(html);
  
  initMessageQueues();
  sendToClient(messages);
}

  function NoticeLog( log ) {
    var message = { log: log };
    Enqueue('TO_CLIENT', message);
  }
  
//********************************************************************************************************************
// NoticePrompt - send a prompt to the sidebar and wait for a response
//   prompt - the prompt to display in the sidebar
//   returns the user's response
//   Note: this function will block until a response is received
//         or the user closes the sidebar
function NoticePrompt(prompt) {
  var message = { prompt: prompt }; 
  sendToClient(message);
  updateClientActivityTime(); // update the last client activity time to prevent timeout

  var response = null;
  while (!response) {
    response = getServerMessage(); // check for a response from the server queue
    if (!response) {
      // if the client has not made a callback in 10 seconds then we will timeout
      if (getLastClientActivityTime() + 10000 < new Date().getTime()) {
        Logger.log('Timed out waiting for response');
        return null;
      } 
    }
    Utilities.sleep(1000);
  }
  return response;
}

function initMessageQueues() {
  setScriptProperty('TO_SERVER', []);
  setScriptProperty('TO_CLIENT', []);
  updateClientActivityTime();
}

// setScriptProperties - set the script properties with the messages object
function setScriptProperty(prop, messages) {
  PropertiesService.getScriptProperties().setProperty(prop, JSON.stringify(messages));
}
// getScriptProperties - get the messages object from the script properties
function getScriptProperty(prop) {
  var messages = PropertiesService.getScriptProperties().getProperty(prop);
  return messages ? JSON.parse(messages) : null;
}

// run a function guaranteed to prevent concurrent access to the script properties
function runWithLock(func) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);  // wait 30 seconds before conceding an error
    func();
  } catch (e) {
    Logger.log('Error: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

// Function to handle submit form response callback from client.  
// Enqueues the response to the script properties.
function sendToServer(message) {
  // run the following code with a lock to prevent concurrent access to the script properties
  Enqueue('TO_SERVER', message);
  setScriptProperty('LastClientAction', new Date().getTime());
}
function dbg(prop,val) {
  setScriptProperty(prop,val);
}
function getServerMessage() {
  var msg;
  msg = Dequeue('TO_SERVER');
  return msg;
}

function sendToClient(message) {
  Enqueue('TO_CLIENT', message);
}

// getMessages - sidebar callback to retrieve the messages property safely ensuring concurrency is handled.
function getClientMessage() {
  var msg;
  msg = Dequeue('TO_CLIENT');
  updateClientActivityTime();
  return msg;
}

function updateClientActivityTime() {
  setScriptProperty('LastClientAction', new Date().getTime());
}
// get the last time the client accessed the server
function getLastClientActivityTime() {
  return getScriptProperty('LastClientAction');
}
function Enqueue( type, response ) {
  runWithLock(function() {
    var queue = getScriptProperty(type);
    if (!queue) {
      queue = [response];
    } else {
      queue.push(response);
    }
    setScriptProperty(type, queue);
  });
}
  
function Dequeue( type ) {
  var response = null;
  runWithLock(function() {
    var queue = getScriptProperty(type);
    if (queue && queue.length > 0) {
      response = queue.shift();
      setScriptProperty(type, queue);
    }
  });
  return response;
}

