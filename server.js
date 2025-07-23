const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidV4 } = require('uuid');
const path = require('path'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 5000;
const engine = require("ejs-mate");
app.engine("ejs",engine);
app.use(express.static(path.join(__dirname,"/public")))

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.render(`Home.ejs`);
});

app.get('/room', (req, res) => {
  res.redirect(`/room/${uuidV4()}`);
});

app.get('/room/:room', (req, res) => {
  res.render('room', { roomId: req.params.room });
});

io.on('connection', (socket) => {
  socket.on('join-room', (roomId, userId) => {
    socket.join(roomId);
    socket.to(roomId).emit('user-connected', userId);

    socket.on('video-url', (url) => {
      socket.to(roomId).emit('video-url', url);
    });

    socket.on('video-control', (data) => {
      socket.to(roomId).emit('video-control', data);
    });

    socket.on('disconnect', () => {
      socket.to(roomId).emit('user-disconnected', userId);
    });
  });
});

server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
