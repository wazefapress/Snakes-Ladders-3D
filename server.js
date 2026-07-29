const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

// إعداد Socket.io مع السماح بالاتصال من أي مصدر
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// تخزين حالة الغرف النشطة
const rooms = {};

io.on('connection', (socket) => {
    console.log(`[+] لاعب متصل: ${socket.id}`);

    // 1. إنشاء غرفة جديدة
    socket.on('createRoom', (playerData) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        socket.join(roomCode);
        rooms[roomCode] = {
            players: [{ id: socket.id, name: playerData.name }],
            turnIndex: 0, // صاحب الدور الأول
            gameStarted: false
        };

        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
        console.log(`غرفة أنشئت: ${roomCode} بواسطة ${playerData.name}`);
    });

    // 2. الانضمام لغرفة موجودة
    socket.on('joinRoom', ({ roomCode, playerData }) => {
        const room = rooms[roomCode];
        
        if (room) {
            if (room.gameStarted) {
                socket.emit('error', 'عذراً، اللعبة قد بدأت بالفعل!');
                return;
            }
            if (room.players.length >= 4) {
                socket.emit('error', 'عذراً، الغرفة ممتلئة!');
                return;
            }

            socket.join(roomCode);
            room.players.push({ id: socket.id, name: playerData.name });

            socket.emit('joinedRoom', { roomCode, players: room.players });
            io.to(roomCode).emit('playerJoined', room.players);

            // بدء اللعبة تلقائياً بمجرد اكتمال لاعبين أو أكثر
            if (room.players.length >= 2) {
                room.gameStarted = true;
                io.to(roomCode).emit('gameStart', { 
                    players: room.players, 
                    turnIndex: room.turnIndex 
                });
                console.log(`بدء اللعبة في الغرفة: ${roomCode}`);
            }
        } else {
            socket.emit('error', 'كود الغرفة غير صحيح!');
        }
    });

    // 3. التحكم الآمن في رمي النرد وإدارة الأدوار (منع الغش)
    socket.on('rollDiceRequest', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;

        // التحقق من أن المرسل هو صاحب الدور الحالي فعلياً على الخادم
        const currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== socket.id) {
            socket.emit('error', 'ليس دورك للعب الآن!');
            return;
        }

        // توليد النرد حصرياً على الخادم
        const diceValue = Math.floor(Math.random() * 6) + 1;
        
        // حفظ مؤشر اللاعب الذي قام بالرمي حالياً
        const rollingPlayerIndex = room.turnIndex;

        // تحديث الدور للاعب التالي بشكل دائري
        room.turnIndex = (room.turnIndex + 1) % room.players.length;

        // تعميم النتيجة والدور القادم على جميع لاعبي الغرفة
        io.to(roomCode).emit('diceRolledResult', {
            diceValue: diceValue,
            playerIndex: rollingPlayerIndex,
            nextTurnIndex: room.turnIndex,
            nextPlayerName: room.players[room.turnIndex].name
        });
    });

    // 4. معالجة حالات انقطاع الاتصال ومغادرة اللاعبين
    socket.on('disconnect', () => {
        console.log(`[-] انقطع اتصال اللاعب: ${socket.id}`);

        for (let roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);

            if (playerIndex !== -1) {
                const disconnectedPlayer = room.players.splice(playerIndex, 1)[0];
                console.log(`[إشعار] اللاعب ${disconnectedPlayer.name} غادر الغرفة ${roomCode}`);

                // إذا أصبحت الغرفة فارغة، يتم حذفها نهائياً لتفريغ الذاكرة
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                    console.log(`[حذف] تم إغلاق وتطهير الغرفة الفارغة: ${roomCode}`);
                } 
                // إذا انسحب لاعب أثناء اللعبة وبقي لاعب واحد، يعتبر الباقي فائزاً
                else if (room.gameStarted && room.players.length === 1) {
                    const winner = room.players[0];
                    io.to(roomCode).emit('playerDisconnectedWin', {
                        message: `انسحب اللاعب ${disconnectedPlayer.name} بسبب انقطاع الاتصال. الفائز هو ${winner.name}!`,
                        winnerName: winner.name
                    });
                    delete rooms[roomCode];
                } 
                // إذا تبقى أكثر من لاعب، يتم تحديث القائمة وإصلاح مؤشر الدور
                else {
                    if (room.turnIndex >= room.players.length) {
                        room.turnIndex = 0;
                    }
                    io.to(roomCode).emit('playerJoined', room.players);
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