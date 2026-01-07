import { useState, useEffect } from 'react'
import axios from 'axios'
import SockJS from 'sockjs-client/dist/sockjs';
import { Stomp } from '@stomp/stompjs';

// Cấu hình URL Backend
const API_URL = 'http://localhost:8080/api/rooms';
const WS_URL = 'http://localhost:8080/ws';

function App() {
    // --- STATE QUẢN LÝ ---
    const [username, setUsername] = useState("");
    const [inputRoomId, setInputRoomId] = useState("");
    const [isJoined, setIsJoined] = useState(false);

    const [roomId, setRoomId] = useState(null)
    const [gameData, setGameData] = useState(null)
    const [selectedAnswer, setSelectedAnswer] = useState(null)
    const [resultData, setResultData] = useState(null)

    // State riêng cho các phase
    const [myRole, setMyRole] = useState(null);
    const [betAmount, setBetAmount] = useState(100);
    const [isBetSubmitted, setIsBetSubmitted] = useState(false);
    const [tradersList, setTradersList] = useState([]);

    // --- 1. API: TẠO PHÒNG ---
    const handleCreateRoom = async () => {
        if (!username || !inputRoomId) return alert("Nhập đủ tên và mã phòng!");
        try {
            await axios.post(`${API_URL}/create?roomId=${inputRoomId.trim()}&hostId=${username}`);
            setRoomId(inputRoomId.trim());
            setIsJoined(true);
        } catch (err) { alert("Lỗi: " + err.message); }
    }

    // --- 2. API: VÀO PHÒNG ---
    const handleJoinRoom = async () => {
        if (!username || !inputRoomId) return alert("Nhập đủ tên và mã phòng!");
        try {
            await axios.post(`${API_URL}/${inputRoomId.trim()}/join?playerId=${username}`);
            setRoomId(inputRoomId.trim());
            setIsJoined(true);
        } catch (err) { alert("Lỗi: " + (err.response?.data?.error || err.message)); }
    }

    // --- 3. API: BẮT ĐẦU GAME ---
    const handleStartGame = async () => {
        try { await axios.post(`${API_URL}/${roomId}/start?playerId=${username}`); }
        catch (err) { console.error(err); }
    }

    // --- 4. API: ĐẶT CƯỢC (BETTING) ---
    const handleBet = async () => {
        try {
            await axios.post(`${API_URL}/${roomId}/bet`, {
                playerId: username,
                amount: betAmount
            });
            setIsBetSubmitted(true);
        } catch (err) { console.error(err); }
    }

    // --- 5. API: CHỌN ROLE (BLIND BET) ---
    const handleSelectRole = async (role) => {
        try {
            await axios.post(`${API_URL}/${roomId}/choose-role`, {
                playerId: username,
                role: role
            });
            setMyRole(role);
        } catch (err) { console.error(err); }
    }

    // --- 6. API: ĐẦU TƯ (INVESTMENT) ---
    const handleInvest = async (targetId) => {
        try {
            await axios.post(`${API_URL}/${roomId}/invest`, {
                playerId: username,
                targetId: targetId
            });
            alert(`Đã chọn đầu tư vào: ${targetId}`);
        } catch (err) { console.error(err); }
    }

    // --- 7. API: GỬI ĐÁP ÁN ---
    const handleSelectAnswer = async (answer) => {
        if (selectedAnswer) return;
        setSelectedAnswer(answer);
        try {
            await axios.post(`${API_URL}/${roomId}/submit`, {
                playerId: username,
                answer: answer.charAt(0) // Lấy chữ cái đầu A,B,C,D
            });
        } catch (err) { console.error(err); }
    }

    // --- WEBSOCKET CONNECTION ---
    useEffect(() => {
        if (!isJoined || !roomId) return;

        const socket = new SockJS(WS_URL);
        const stompClient = Stomp.over(socket);
        stompClient.debug = () => {}; // Tắt log debug cho đỡ rối

        stompClient.connect({}, () => {
            // 1. Nghe data chung
            stompClient.subscribe(`/topic/game/${roomId}`, (message) => {
                const data = JSON.parse(message.body);
                console.log("🔥 GAME STATE:", data.currentState); // Log để debug
                setGameData(data);

                // Reset state cục bộ khi bắt đầu vòng mới
                if (data.currentState === 'BLIND_BET') {
                    setResultData(null);
                    setMyRole(null);
                    setSelectedAnswer(null);
                    setIsBetSubmitted(false);
                }
            });

            // 2. Nghe danh sách Traders
            stompClient.subscribe(`/topic/game/${roomId}/traders`, (message) => {
                const data = JSON.parse(message.body);
                setTradersList(data.traders || []);
            });

            // 3. Nghe tin nhắn riêng (Role bí mật)
            stompClient.subscribe(`/user/queue/private`, (message) => {
                const msg = JSON.parse(message.body);
                if (msg.role) setMyRole(msg.role); // Cập nhật lại role nếu cần
            });

            // 4. Nghe Role Bí mật (Oracle/Scammer)
            stompClient.subscribe(`/user/queue/private/role`, (message) => {
                const msg = JSON.parse(message.body);
                if (msg.secretRole && msg.secretRole !== 'NORMAL') {
                    alert(`🤫 MẬT VỤ: Bạn là ${msg.secretRole}!`);
                }
            });

            // 5. Nghe kết quả
            stompClient.subscribe(`/topic/game/${roomId}/results`, (message) => {
                setResultData(JSON.parse(message.body));
            });

            // 6. Nghe lỗi
            stompClient.subscribe(`/topic/game/${roomId}/error`, (message) => {
                const err = JSON.parse(message.body);
                alert("⚠️ " + err.message);
                setMyRole(null); // Reset để chọn lại
            });
        });

        return () => { if (stompClient) stompClient.disconnect(); };
    }, [isJoined, roomId]);

    // --- RENDER LOGIC ---
    if (!isJoined) {
        return (
            <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
                <h1 className="text-5xl font-black text-yellow-500 mb-8">TRUST MARKET</h1>
                <div className="bg-gray-800 p-8 rounded-xl border border-gray-700 w-full max-w-md space-y-4">
                    <input value={username} onChange={e => setUsername(e.target.value)} className="w-full bg-gray-900 p-3 rounded text-white border border-gray-600" placeholder="Tên của bạn" />
                    <input value={inputRoomId} onChange={e => setInputRoomId(e.target.value)} className="w-full bg-gray-900 p-3 rounded text-white border border-gray-600 font-mono text-center font-bold" placeholder="Mã Phòng (VD: 101)" />
                    <div className="flex gap-2">
                        <button onClick={handleCreateRoom} className="flex-1 bg-yellow-600 py-3 rounded font-bold hover:bg-yellow-500">TẠO PHÒNG</button>
                        <button onClick={handleJoinRoom} className="flex-1 bg-blue-600 py-3 rounded font-bold hover:bg-blue-500">VÀO CHƠI</button>
                    </div>
                </div>
            </div>
        );
    }

    const me = gameData?.players[username];
    const myCash = me ? me.cash : 0;

    // Logic xác định quyền trả lời
    const isTrader = me?.role === 'TRADER';
    const isInvestor = me?.role === 'INVESTOR';
    const canAnswer = (gameData?.currentState === 'MARKET_CHAT' || gameData?.currentState === 'CLOSING') && isTrader;

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4">
            {/* HEADER */}
            <div className="w-full max-w-4xl flex justify-between items-end border-b border-gray-700 pb-4 mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-yellow-400">{username}</h2>
                    <p className="text-sm text-gray-400">Room: {roomId} | Round: {gameData?.currentRound}/{gameData?.totalRounds}</p>
                </div>
                <div className="text-right">
                    <div className="text-3xl font-black text-green-400">{myCash.toFixed(0)}$</div>
                    <div className="px-3 py-1 rounded text-xs font-bold mt-1 bg-gray-700 inline-block">
                        {gameData?.currentState}
                    </div>
                </div>
            </div>

            {/* MAIN AREA */}
            <div className="w-full max-w-2xl flex-1 flex flex-col items-center">

                {/* 1. LOBBY */}
                {(!gameData || gameData.currentState === 'WAITING') && (
                    <div className="text-center mt-20">
                        <div className="text-6xl mb-4">⏳</div>
                        <h3 className="text-xl font-bold mb-6">Đang chờ người chơi... ({gameData ? Object.keys(gameData.players).length : 1})</h3>
                        {gameData?.hostId === username && (
                            <button onClick={handleStartGame} className="bg-green-600 px-8 py-3 rounded-lg font-bold hover:scale-105 transition shadow-lg animate-pulse">
                                👑 BẮT ĐẦU GAME
                            </button>
                        )}
                    </div>
                )}

                {/* 2. BLIND BET (Chọn Vị Thế) */}
                {gameData && gameData.currentState === 'BLIND_BET' && (
                    <div className="w-full text-center">
                        <h2 className="text-3xl font-black text-white mb-2">CHỌN VỊ THẾ</h2>
                        <div className="text-4xl font-mono font-bold text-red-500 mb-6">{gameData.timeRemaining}s</div>

                        {/* Thanh trượt tiền */}
                        <div className="bg-gray-800 p-4 rounded-xl mb-6">
                            <div className="text-3xl font-bold text-green-400 mb-2">{betAmount}$</div>
                            <input type="range" min="100" max={myCash} step="50" value={betAmount}
                                   onChange={(e) => setBetAmount(Number(e.target.value))}
                                   className="w-full accent-yellow-500"/>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={() => { handleBet(); handleSelectRole('TRADER'); }}
                                    className={`p-8 rounded-2xl border-4 transition-all ${myRole === 'TRADER' ? 'bg-red-900 border-red-500' : 'bg-gray-800 border-gray-600'}`}>
                                <div className="text-4xl mb-2">🔥</div>
                                <div className="text-2xl font-black text-red-400">TRADER</div>
                                <p className="text-xs text-gray-400 mt-2">Tự trả lời - Rủi ro cao</p>
                            </button>
                            <button onClick={() => { handleBet(); handleSelectRole('INVESTOR'); }}
                                    className={`p-8 rounded-2xl border-4 transition-all ${myRole === 'INVESTOR' ? 'bg-blue-900 border-blue-500' : 'bg-gray-800 border-gray-600'}`}>
                                <div className="text-4xl mb-2">💎</div>
                                <div className="text-2xl font-black text-blue-400">INVESTOR</div>
                                <p className="text-xs text-gray-400 mt-2">Đầu tư - Ăn theo</p>
                            </button>
                        </div>
                    </div>
                )}

                {/* 3. ROLE ASSIGN (Animation phân vai) */}
                {gameData && gameData.currentState === 'ROLE_ASSIGN' && (
                    <div className="text-center mt-20 animate-bounce">
                        <div className="text-6xl mb-4">🎲</div>
                        <h2 className="text-2xl font-bold text-yellow-400">HỆ THỐNG ĐANG PHÂN VAI...</h2>
                        <p className="text-gray-400">Ai là Tiên Tri? Ai là Kẻ Lừa Đảo?</p>
                    </div>
                )}

                {/* 4. MARKET CHAT (Giao dịch & Trả lời) */}
                {gameData && (gameData.currentState === 'MARKET_CHAT' || gameData.currentState === 'CLOSING') && (
                    <div className="w-full space-y-6">
                        <div className="flex justify-between items-center bg-gray-800 p-4 rounded-lg">
                            <span className="font-bold text-yellow-500">SÀN GIAO DỊCH</span>
                            <span className="text-3xl font-mono font-bold text-red-500">{gameData.timeRemaining}s</span>
                        </div>

                        {/* PHẦN CÂU HỎI (Cho Trader) */}
                        {gameData.currentQuestion && (
                            <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
                                <h3 className="text-xl font-medium mb-4">{gameData.currentQuestion.question}</h3>
                                <div className="grid grid-cols-1 gap-3">
                                    {gameData.currentQuestion.options.map(opt => (
                                        <button key={opt}
                                                onClick={() => canAnswer && handleSelectAnswer(opt)}
                                                disabled={!canAnswer || selectedAnswer}
                                                className={`p-4 text-left rounded-lg font-bold border-l-4 transition-all
                                                    ${selectedAnswer === opt.charAt(0) ? 'bg-yellow-600 border-yellow-300' :
                                                    canAnswer ? 'bg-gray-700 border-gray-500 hover:bg-gray-600' : 'bg-gray-800 opacity-50'}`}>
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                                {!canAnswer && isInvestor && <p className="text-center text-xs text-gray-500 mt-4">Chỉ Trader trả lời. Bạn hãy chọn Trader để đầu tư!</p>}
                            </div>
                        )}

                        {/* DANH SÁCH TRADER (Cho Investor chọn) */}
                        {isInvestor && (
                            <div className="bg-gray-900 p-4 rounded-xl border border-blue-900">
                                <h4 className="text-blue-400 font-bold mb-3">CHỌN TRADER ĐỂ RÓT VỐN:</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    {tradersList.map(t => (
                                        <button key={t.id} onClick={() => handleInvest(t.id)}
                                                className="flex items-center p-3 bg-gray-800 border border-gray-600 rounded-lg hover:border-green-500 hover:bg-gray-700 transition">
                                            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-bold mr-3">{t.displayName.charAt(0)}</div>
                                            <div className="text-left">
                                                <div className="font-bold">{t.displayName}</div>
                                                <div className="text-xs text-green-400">Đang gọi vốn</div>
                                            </div>
                                        </button>
                                    ))}
                                    {tradersList.length === 0 && <p className="text-gray-500 italic">Chưa có dữ liệu Trader...</p>}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* 5. CALCULATION (Màn hình chờ kết quả) */}
                {gameData && gameData.currentState === 'CALCULATION' && (
                    <div className="text-center mt-20">
                        <h2 className="text-2xl font-bold text-green-400 animate-pulse">ĐANG TÍNH TIỀN... 💸</h2>
                    </div>
                )}

            </div>

            {/* RESULTS POPUP */}
            {resultData && (
                <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 animate-fade-in">
                    <div className="bg-gray-800 p-6 rounded-xl border-2 border-yellow-500 max-w-md w-full m-4 shadow-2xl">
                        <h2 className="text-3xl font-black text-center text-yellow-400 mb-6">KẾT QUẢ</h2>

                        {/* Đáp án đúng (Chỉ hiện nếu có câu hỏi) */}
                        {resultData.correctAnswer && (
                            <div className="text-center mb-6 bg-gray-900 p-3 rounded">
                                <span className="text-gray-400 text-sm uppercase">Đáp án đúng</span>
                                <span className="text-4xl font-bold text-green-400 block mt-1">{resultData.correctAnswer}</span>
                            </div>
                        )}

                        {/* Danh sách tiền */}
                        <div className="max-h-80 overflow-y-auto space-y-2 mb-6 pr-2">
                            {resultData.results?.map((r, i) => (
                                <div key={i} className="flex justify-between items-center p-3 bg-gray-700/50 rounded hover:bg-gray-700 transition">
                                    <div>
                                        <div className="font-bold text-white">{r.displayName}</div>
                                        <div className="text-xs text-gray-400">{r.reason}</div>
                                    </div>
                                    <span className={`font-mono font-bold text-lg ${r.profitLoss >= 0 ? "text-green-400" : "text-red-500"}`}>
                                        {r.profitLoss > 0 ? '+' : ''}{Number(r.profitLoss).toFixed(0)}$
                                    </span>
                                </div>
                            ))}
                        </div>
                        <button onClick={() => setResultData(null)} className="w-full bg-yellow-600 py-4 rounded-lg font-bold text-xl hover:bg-yellow-500 transition shadow-lg">
                            TIẾP TỤC 🔥
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default App