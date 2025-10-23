const fs = require('fs-extra');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const DB_FILE = './db.json';
let db = fs.existsSync(DB_FILE) ? fs.readJsonSync(DB_FILE) : { users:{}, servers:{}, reports:[], globalBans:[], registrationRequests:[], achievements:[] };

if(!db.users['memegodmidas']){
  db.users['memegodmidas'] = {
    password:"Godsatan1342",
    nickname:"Admin",
    globalAdmin:true,
    blocked:[],
    permissions:{kick:true,ban:true,timeout:true,manageBadges:true,manageNicknames:true},
    achievements:[],
    profileBadges:[],
    profilePic:""
  };
  fs.writeJsonSync(DB_FILE,db,{spaces:2});
}

const connectedUsers = {};

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(cookieParser());
app.use(express.static('public'));

// File uploads
const storage = multer.diskStorage({
  destination: function(req,file,cb){
    const userFolder = 'public/uploads/' + req.cookies.username;
    fs.ensureDirSync(userFolder);
    cb(null,userFolder);
  },
  filename: function(req,file,cb){ cb(null,Date.now()+'_'+file.originalname); }
});
const upload = multer({storage});

// Save DB helper
function saveDB(){ fs.writeJsonSync(DB_FILE, db, {spaces:2}); }
function usernameForSocket(socket){ return connectedUsers[socket.id]; }
function getAdminSockets(){ 
  const sockets = [];
  for(const [sid, uname] of Object.entries(connectedUsers)){
    if(db.users[uname]?.globalAdmin){
      const s = io.sockets.sockets.get(sid);
      if(s) sockets.push(s);
    }
  }
  return sockets;
}

// -------------------
// Registration/Login
// -------------------
app.post('/login', (req,res)=>{
  const { username,password,action } = req.body;
  if(!username||!password) return res.status(400).send('username & password required');

  if(action==='register'){
    if(db.users[username]) return res.status(400).send('Username taken!');
    db.users[username] = {password,nickname:"",globalAdmin:false,blocked:[],permissions:{},achievements:[],profileBadges:[],profilePic:""};
    db.registrationRequests.push({id:'rr-'+Date.now(),username,createdAt:Date.now(),status:'pending'});
    saveDB();
    getAdminSockets().forEach(s=>s.emit('new-registration-request',{username}));
    return res.send('Registration request sent to admin.');
  } else {
    if(!db.users[username]||db.users[username].password!==password) return res.status(400).send('Invalid credentials');
    res.cookie('username',username,{maxAge:7*24*60*60*1000});
    return res.redirect('/chat');
  }
});

app.get('/chat',(req,res)=>{
  const username=req.cookies.username;
  if(!username||!db.users[username]) return res.redirect('/');
  res.sendFile(__dirname+'/public/index.html');
});

// User profile
app.get('/profile',(req,res)=>{
  const user=req.query.user||req.cookies.username;
  if(!user||!db.users[user]) return res.status(404).send('User not found');
  res.sendFile(__dirname+'/public/profile.html');
});

// Profile picture upload
app.post('/profile-pic', upload.single('file'), (req,res)=>{
  const username=req.cookies.username;
  if(!username) return res.status(403).send('Not logged in');
  db.users[username].profilePic='/uploads/'+username+'/'+req.file.filename;
  saveDB();
  res.send({url:db.users[username].profilePic});
});

// -------------------
// Socket.io
// -------------------
io.on('connection', socket=>{
  socket.on('login', ({username})=>{
    if(!username||!db.users[username]) return socket.emit('login-failed');
    connectedUsers[socket.id]=username;
    socket.emit('login-success',{username});
    socket.emit('load-data', db);
  });

  socket.on('send-message', ({server, channel, text})=>{
    const user=usernameForSocket(socket);
    if(!user) return;
    if(!db.servers[server]) db.servers[server]={channels:{},owner:user,mutedUsers:{},bannedUsers:[],userXP:{}};
    if(!db.servers[server].channels[channel]) db.servers[server].channels[channel]=[];
    const msg={id:'m-'+Date.now(),username:user,text,nickname:db.users[user].nickname||"" ,timestamp:Date.now()};
    db.servers[server].channels[channel].push(msg);
    db.servers[server].userXP[user]=(db.servers[server].userXP[user]||0)+10;
    saveDB();
    io.emit('receive-message',{server,channel,message:msg,userXP:db.servers[server].userXP[user]});
  });

  socket.on('send-dm', ({target,text})=>{
    const sender=usernameForSocket(socket);
    if(!sender||!db.users[target]) return;
    if(db.users[target].blocked.includes(sender)) return;
    io.sockets.sockets.forEach(s=>{
      const uname=connectedUsers[s.id];
      if(uname===target||uname===sender) s.emit('receive-dm',{from:sender,to:target,text});
    });
  });

  // nicknames
  socket.on('set-nickname', ({nickname})=>{
    const user=usernameForSocket(socket);
    if(!user) return;
    db.users[user].nickname=nickname;
    saveDB();
    io.emit('nickname-updated',{user,nickname});
  });

  // moderation
  socket.on('moderation-action', payload=>{
    const actor=usernameForSocket(socket);
    if(!actor) return;
    if(!db.users[actor].globalAdmin) return socket.emit('moderation-denied');
    io.emit('moderation-occurred',payload);
  });

  // WebRTC signaling
  socket.on('webrtc-join', ({server, channel})=>{ socket.join(server+'-'+channel); });
  socket.on('webrtc-offer', data=>{ socket.to(data.room).emit('webrtc-offer', data); });
  socket.on('webrtc-answer', data=>{ socket.to(data.room).emit('webrtc-answer', data); });
  socket.on('webrtc-ice', data=>{ socket.to(data.room).emit('webrtc-ice', data); });

  socket.on('disconnect',()=>{ delete connectedUsers[socket.id]; });
});

http.listen(3000, ()=>console.log('Server running on http://localhost:3000'));
