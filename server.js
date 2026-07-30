const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

io.on('connection', (socket) => {
    console.log(`[+] لاعب متصل: ${socket.id}`);

    socket.on('createRoom', (playerData) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        socket.join(roomCode);
        rooms[roomCode] = {
            players: [{ id: socket.id, name: playerData.name }],
            turnIndex: 0,
            gameStarted: false
        };

        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
        console.log(`غرفة أنشئت: ${roomCode} بواسطة ${playerData.name}`);
    });

    socket.on('joinRoom', ({ roomCode, playerData }) => {
        const room = rooms[roomCode];
        
        if (room) {
            if (room.gameStarted) {
                socket.emit('error', 'عذراً، اللعبة قد بدأت بالفعل!');
                return;
            }
            if (room.players.length >= 2) {
                socket.emit('error', 'عذراً، الغرفة ممتلئة!');
                return;
            }

            socket.join(roomCode);
            room.players.push({ id: socket.id, name: playerData.name });

            // إرسال تأكيد الانضمام للاعب الثاني وتحديث البيانات
            socket.emit('joinedRoom', { roomCode, players: room.players });

            // بمجرد اكتمال اللاعبين (لاعبين اثنين)، تبدأ اللعبة فوراً للطرفين
            if (room.players.length === 2) {
                room.gameStarted = true;
                io.to(roomCode).emit('gameStart', { 
                    players: room.players, 
                    turnIndex: room.turnIndex 
                });
                console.log(`بدء مباراة 1 ضد 1 في الغرفة: ${roomCode}`);
            }
        } else {
            socket.emit('error', 'كود الغرفة غير صحيح!');
        }
    });

    socket.on('rollDiceRequest', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== socket.id) {
            socket.emit('error', 'ليس دورك للعب الآن!');
            return;
        }

        const diceValue = Math.floor(Math.random() * 6) + 1;
        const rollingPlayerIndex = room.turnIndex;
        room.turnIndex = (room.turnIndex + 1) % room.players.length;

        io.to(roomCode).emit('diceRolledResult', {
            diceValue: diceValue,
            playerIndex: rollingPlayerIndex,
            nextTurnIndex: room.turnIndex,
            nextPlayerName: room.players[room.turnIndex].name
        });
    });

    socket.on('disconnect', () => {
        console.log(`[-] انقطع اتصال اللاعب: ${socket.id}`);

        for (let roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);

            if (playerIndex !== -1) {
                const disconnectedPlayer = room.players.splice(playerIndex, 1)[0];
                
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                } else if (room.gameStarted && room.players.length === 1) {
                    const winner = room.players[0];
                    io.to(roomCode).emit('playerDisconnectedWin', {
                        message: `انسحب اللاعب ${disconnectedPlayer.name}. الفائز هو ${winner.name}!`,
                        winnerName: winner.name
                    });
                    delete rooms[roomCode];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🚀 خادم الألعاب يعمل بكفاءة على البورت ${PORT}`);
});