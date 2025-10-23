const socket=io();
let currentUser=null;

socket.on('login-success',({username})=>currentUser=username);
socket.on('load-data',db=>console.log('Loaded DB',db));

document.getElementById('send-btn').onclick=()=>{
  const text=document.getElementById('chat-input').value;
  socket.emit('send-message',{server:'default',channel:'general',text});
  document.getElementById('chat-input').value='';
};

function highlightMentions(messageText){
  return messageText.replace(/@(\w+)/g,(match,username)=>{
    return `<span class="mention">@${username}</span>`;
  });
}

socket.on('receive-message',({message})=>{
  const container=document.getElementById('chat-container');
  const div=document.createElement('div');
  div.className='message';
  div.innerHTML=`<b>${message.nickname||message.username}</b>: ${highlightMentions(message.text)}`;
  container.appendChild(div);
  div.scrollIntoView({behavior:'smooth'});
});

// nicknames
function setNickname(nick){ socket.emit('set-nickname',{nickname:nick}); }
socket.on('nickname-updated',({user,nickname})=>{ console.log(`${user} changed nickname to ${nickname}`); });

// Themes
function setTheme(theme){
  document.body.className=theme;
  localStorage.setItem('theme',theme);
}
const savedTheme=localStorage.getItem('theme')||'dark';
setTheme(savedTheme);

// WebRTC voice/video
function joinVoice(server, channel){
  socket.emit('webrtc-join',{server,channel});
  navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(stream=>{
    const localVideo=document.createElement('video');
    localVideo.srcObject=stream;
    localVideo.autoplay=true;
    localVideo.muted=true;
    document.body.appendChild(localVideo);

    const pc=new RTCPeerConnection();
    stream.getTracks().forEach(track=>pc.addTrack(track,stream));

    pc.ontrack=e=>{
      const remoteVideo=document.createElement('video');
      remoteVideo.srcObject=e.streams[0];
      remoteVideo.autoplay=true;
      document.body.appendChild(remoteVideo);
    };

    pc.onicecandidate=e=>{
      if(e.candidate) socket.emit('webrtc-ice',{room:server+'-'+channel,candidate:e.candidate});
    };

    socket.on('webrtc-offer', async data=>{
      await pc.setRemoteDescription(data.offer);
      const answer=await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-answer',{room:data.room,answer});
    });

    socket.on('webrtc-answer', async data=>{
      await pc.setRemoteDescription(data.answer);
    });

    socket.on('webrtc-ice', async data=>{
      try{ await pc.addIceCandidate(data.candidate);}catch{}
    });

  });
}
