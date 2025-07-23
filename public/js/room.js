const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const myVideo = document.getElementById('my-video');
const videoForm = document.getElementById('video-form');
const videoUrlInput = document.getElementById('video-url');
const sharedVideo = document.getElementById('shared-video');

let useFrontCamera = true;
let currentStream;
const peerCalls = {};
const connectedUsers = new Set();

let ytPlayer = null;
let dmPlayer = null;
let activePlayer = null;
let suppressEmit = false;

myVideo.muted = true;
const peer = new Peer();

navigator.mediaDevices.getUserMedia({
  video: { facingMode: "user" },
  audio: true
}).then(stream => {
  currentStream = stream;
  myVideo.srcObject = stream;
  myVideo.addEventListener('loadedmetadata', () => myVideo.play());
  videoGrid.append(myVideo);

  peer.on('call', call => {
    call.answer(currentStream);
    const video = document.createElement('video');
    video.setAttribute('playsinline', true);
    call.on('stream', userVideoStream => {
      video.srcObject = userVideoStream;
      video.addEventListener('loadedmetadata', () => video.play());
      videoGrid.append(video);
    });
    call.on('close', () => video.remove());
    peerCalls[call.peer] = call;
  });

  socket.on('user-connected', userId => {
    if (!connectedUsers.has(userId)) {
      connectedUsers.add(userId);
      connectToNewUser(userId, currentStream);
    }
  });
}).catch(err => console.error('Media access error:', err));

peer.on('open', id => {
  const roomId = window.location.pathname.split('/')[2];
  socket.emit('join-room', roomId, id);
});

function connectToNewUser(userId, stream) {
  const call = peer.call(userId, stream);
  const video = document.createElement('video');
  video.setAttribute('playsinline', true);

  call.on('stream', userVideoStream => {
    video.srcObject = userVideoStream;
    video.addEventListener('loadedmetadata', () => video.play());
    videoGrid.append(video);
  });

  call.on('close', () => video.remove());
  peerCalls[userId] = call;
}

videoForm.addEventListener('submit', e => {
  e.preventDefault();
  const url = videoUrlInput.value.trim();
  if (url) {
    socket.emit('video-url', url);
    displaySyncedVideo(url);
  }
});


socket.on('video-url', url => {
  videoUrlInput.value = url;
  displaySyncedVideo(url);
});

function displaySyncedVideo(url) {
  sharedVideo.innerHTML = '';
  ytPlayer = dmPlayer = activePlayer = null;

  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const id = url.includes('youtube.com')
      ? new URLSearchParams(url.split('?')[1]).get('v')
      : url.split('youtu.be/')[1].split('?')[0];

    const wrapper = document.createElement('div');
    wrapper.className = 'responsive-player';

    const playerDiv = document.createElement('div');
    playerDiv.id = 'yt-player';

    wrapper.appendChild(playerDiv);
    sharedVideo.appendChild(wrapper);

    new YT.Player('yt-player', {
      height: 'auto',
      width: 'auto',
      videoId: id,
      events: {
        'onReady': (event) => {
          activePlayer = event.target;
        },
        'onStateChange': (event) => {
          if (suppressEmit) return;
          const time = event.target.getCurrentTime();
          if (event.data === YT.PlayerState.PLAYING) {
            socket.emit('video-control', { action: 'play', currentTime: time });
          } else if (event.data === YT.PlayerState.PAUSED) {
            socket.emit('video-control', { action: 'pause', currentTime: time });
          }
        }
      }
    });

  } else if (url.includes('dailymotion.com')) {
    const id = url.split('/video/')[1]?.split('_')[0];

    const wrapper = document.createElement('div');
    wrapper.className = 'responsive-player';

    const dmDiv = document.createElement('div');
    dmDiv.id = 'dm-player';

    wrapper.appendChild(dmDiv);
    sharedVideo.appendChild(wrapper);

    DM.player('dm-player', {
      video: id,
      width: 'auto',
      height: 'auto',
      params: { autoplay: 1 }
    }).then(player => {
      dmPlayer = activePlayer = player;
      player.addEventListener('play', () => {
        if (!suppressEmit) {
          player.currentTime.then(t => {
            socket.emit('video-control', { action: 'play', currentTime: t });
          });
        }
      });
      player.addEventListener('pause', () => {
        if (!suppressEmit) {
          player.currentTime.then(t => {
            socket.emit('video-control', { action: 'pause', currentTime: t });
          });
        }
      });
    });

  } else {
    const wrapper = document.createElement('div');
    wrapper.className = 'responsive-player';

    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    video.style.width = 'auto';
    video.style.height = 'auto';
    video.setAttribute('playsinline', true);

    wrapper.appendChild(video);
    sharedVideo.appendChild(wrapper);

    activePlayer = video;

    video.addEventListener('play', () => {
      if (!suppressEmit)
        socket.emit('video-control', { action: 'play', currentTime: video.currentTime });
    });

    video.addEventListener('pause', () => {
      if (!suppressEmit)
        socket.emit('video-control', { action: 'pause', currentTime: video.currentTime });
    });
  }
}

socket.on('video-control', data => {
  if (!activePlayer) return;
  suppressEmit = true;

  if (typeof activePlayer.seekTo === 'function') {
    activePlayer.seekTo(data.currentTime);
    if (data.action === 'play') activePlayer.playVideo();
    else activePlayer.pauseVideo();
  } else if (typeof activePlayer.currentTime !== 'undefined') {
    activePlayer.currentTime = data.currentTime;
    if (data.action === 'play') activePlayer.play();
    else activePlayer.pause();
  } else if (typeof activePlayer.seek === 'function') {
    activePlayer.seek(data.currentTime);
    if (data.action === 'play') activePlayer.play();
    else activePlayer.pause();
  }

  setTimeout(() => suppressEmit = false, 500);
});

document.getElementById('switch-camera').addEventListener('click', async () => {
  useFrontCamera = !useFrontCamera;
  const constraints = {
    video: { facingMode: useFrontCamera ? 'user' : 'environment' },
    audio: true
  };

  try {
    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = newStream;
    myVideo.srcObject = newStream;
    await myVideo.play();

    for (const userId of connectedUsers) {
      if (peerCalls[userId]) peerCalls[userId].close();
      connectToNewUser(userId, currentStream);
    }
  } catch (err) {
    console.error('Error switching camera:', err);
  }
});

document.getElementById('copy-link').addEventListener('click', () => {
  const roomUrl = window.location.href;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(roomUrl).then(() => alert('Room link copied!'));
  } else {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.value = roomUrl;
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    alert('Room link copied!');
  }
});
