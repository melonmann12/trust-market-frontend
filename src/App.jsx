import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import SockJS from 'sockjs-client/dist/sockjs';
import { Stomp } from '@stomp/stompjs';

// Backend Configuration
const API_URL = 'http://localhost:8080/api/rooms';
const WS_URL = 'http://localhost:8080/ws';

function App() {
    // ═══════════════════════════════════════════════════════════
    // 🎮 STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    // Lobby States
    const [username, setUsername] = useState("");
    const [inputRoomId, setInputRoomId] = useState("");
    const [isJoined, setIsJoined] = useState(false);

    // Game States
    const [roomId, setRoomId] = useState(null)
    const [gameData, setGameData] = useState(null)
    const [selectedAnswer, setSelectedAnswer] = useState(null)
    const [resultData, setResultData] = useState(null)

    // Phase-Specific States
    const [myRole, setMyRole] = useState(null);
    const [secretRole, setSecretRole] = useState(null);
    const [betAmount, setBetAmount] = useState(100);
    const [isBetSubmitted, setIsBetSubmitted] = useState(false);
    const [tradersList, setTradersList] = useState([]);
    const [isRoleLocked, setIsRoleLocked] = useState(false);
    const [isAnswerLocked, setIsAnswerLocked] = useState(false);

    // 🔧 NEW: Round Tracking for Persistent State
    const lastPhaseRef = useRef(null);
    const lastRoundRef = useRef(0);

    // ═══════════════════════════════════════════════════════════
    // 🌐 API HANDLERS
    // ═══════════════════════════════════════════════════════════

    const handleCreateRoom = async () => {
        if (!username || !inputRoomId) return alert("Nhập đủ tên và mã phòng!");
        try {
            await axios.post(`${API_URL}/create?roomId=${inputRoomId.trim()}&hostId=${username}`);
            setRoomId(inputRoomId.trim());
            setIsJoined(true);
        } catch (err) {
            alert("Lỗi: " + err.message);
        }
    }

    const handleJoinRoom = async () => {
        if (!username || !inputRoomId) return alert("Nhập đủ tên và mã phòng!");
        try {
            await axios.post(`${API_URL}/${inputRoomId.trim()}/join?playerId=${username}`);
            setRoomId(inputRoomId.trim());
            setIsJoined(true);
        } catch (err) {
            alert("Lỗi: " + (err.response?.data?.error || err.message));
        }
    }

    const handleStartGame = async () => {
        try {
            await axios.post(`${API_URL}/${roomId}/start?playerId=${username}`);
        }
        catch (err) {
            console.error(err);
        }
    }

    const handleBet = async () => {
        try {
            await axios.post(`${API_URL}/${roomId}/bet`, {
                playerId: username,
                amount: betAmount
            });
            setIsBetSubmitted(true);
        } catch (err) {
            console.error(err);
        }
    }

    const handleSelectRole = async (role) => {
        if (isRoleLocked) {
            console.log("🔒 Role already locked, ignoring click");
            return;
        }

        try {
            console.log("🎭 Selecting role:", role);
            setIsRoleLocked(true); // Lock FIRST
            setMyRole(role);       // Update local state IMMEDIATELY

            await axios.post(`${API_URL}/${roomId}/choose-role`, {
                playerId: username,
                role: role
            });

            // Also place bet if not done
            if (!isBetSubmitted) {
                await handleBet();
            }

            console.log("✅ Role selection complete");

        } catch (err) {
            console.error("❌ Role selection failed:", err);
            // Only unlock on actual API error
            setIsRoleLocked(false);
            setMyRole(null);
        }
    }

    const handleInvest = async (targetId) => {
        try {
            await axios.post(`${API_URL}/${roomId}/invest`, {
                playerId: username,
                targetId: targetId
            });
            alert(`Đã chọn đầu tư vào: ${targetId}`);
        } catch (err) {
            console.error(err);
        }
    }

    const handleSelectAnswer = async (answer) => {
        if (isAnswerLocked || selectedAnswer) {
            console.log("🔒 Answer already locked, ignoring click");
            return;
        }

        try {
            console.log("📝 Selecting answer:", answer);
            setIsAnswerLocked(true);           // Lock FIRST
            setSelectedAnswer(answer.charAt(0)); // Update local state IMMEDIATELY

            await axios.post(`${API_URL}/${roomId}/submit`, {
                playerId: username,
                answer: answer.charAt(0)
            });

            console.log("✅ Answer submitted");

        } catch (err) {
            console.error("❌ Answer submission failed:", err);
            setIsAnswerLocked(false);
            setSelectedAnswer(null);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 🔌 WEBSOCKET CONNECTION
    // ═══════════════════════════════════════════════════════════

    useEffect(() => {
        if (!isJoined || !roomId) return;

        const socket = new SockJS(WS_URL);
        const stompClient = Stomp.over(socket);
        stompClient.debug = () => {};

        stompClient.connect({}, () => {
            console.log("🔌 Connected to WebSocket");

            // 1️⃣ 🔧 FIXED: Main Game State Updates with Round-Based Reset
            stompClient.subscribe(`/topic/game/${roomId}`, (message) => {
                const data = JSON.parse(message.body);
                const incomingRound = data.currentRound || 1;

                // 🔧 CRITICAL: Only reset when round CHANGES
                if (data.currentRound > lastRoundRef.current) {
                    console.log(`🔄 NEW ROUND: ${lastRoundRef.current} -> ${data.currentRound}`);

                    if (data.currentState === 'BLIND_BET') {
                        console.log("🧹 Reset dữ liệu vòng chơi mới...");
                        setResultData(null);
                        setMyRole(null);
                        setSecretRole(null);
                        setSelectedAnswer(null);
                        setIsBetSubmitted(false);
                        setIsRoleLocked(false);
                        setIsAnswerLocked(false);

                        lastRoundRef.current = data.currentRound;
                    }

                    if (data.currentState === 'MARKET_CHAT' && isAnswerLocked && !selectedAnswer) {
                        // Logic phụ: Nếu vào chat mà chưa chọn đáp án thì đảm bảo nút mở
                        // (Nhưng logic trên đã bao quát rồi nên dòng này là optional)
                    }

                    // Cập nhật lại Ref để nhớ Phase hiện tại
                    lastPhaseRef.current = data.currentState;

                    console.log("✅ Local state reset for new round");
                }

                // Always update game data (for timer, etc.)
                setGameData(data);

                // Debug log (only occasionally to avoid spam)
                if (data.timeRemaining % 5 === 0) {
                    console.log(`⏱️ Round ${incomingRound} | ${data.currentState} | ${data.timeRemaining}s`);
                }
            });

            // 2️⃣ Traders List (For Investors)
            stompClient.subscribe(`/topic/game/${roomId}/traders`, (message) => {
                const data = JSON.parse(message.body);
                setTradersList(data.traders || []);
                console.log("👥 Traders list updated:", data.traders?.length || 0);
            });

            // 3️⃣ Private Role Confirmation
            stompClient.subscribe(`/user/queue/private`, (message) => {
                const msg = JSON.parse(message.body);
                if (msg.role) {
                    console.log("✅ Role confirmed via private channel:", msg.role);
                    // Don't override local state - we already set it optimistically
                }
            });

            // 4️⃣ 🔧 FIXED: Secret Role (Persistent Storage)
            stompClient.subscribe(`/user/queue/private/role`, (message) => {
                const msg = JSON.parse(message.body);
                if (msg.secretRole) {
                    console.log("🤫 Secret Role received:", msg.secretRole);
                    setSecretRole(msg.secretRole); // Store in state

                    // Alert for dramatic effect
                    if (msg.secretRole !== 'NORMAL') {
                        setTimeout(() => {
                            alert(`🤫 MẬT VỤ: Bạn là ${msg.secretRole}!`);
                        }, 100);
                    }
                }
            });

            // 5️⃣ Results
            stompClient.subscribe(`/topic/game/${roomId}/results`, (message) => {
                const data = JSON.parse(message.body);
                console.log("💰 Results received");
                setResultData(data);
            });

            // 6️⃣ Error Messages
            stompClient.subscribe(`/topic/game/${roomId}/error`, (message) => {
                const err = JSON.parse(message.body);
                console.error("⚠️ Server error:", err.message);
                alert("⚠️ " + err.message);

                // Only unlock if in BLIND_BET phase (market crash scenario)
                if (gameData?.currentState === 'BLIND_BET') {
                    setIsRoleLocked(false);
                    setMyRole(null);
                }
            });
        });

        return () => {
            if (stompClient) {
                stompClient.disconnect();
                console.log("🔌 Disconnected from WebSocket");
            }
        };
    }, [isJoined, roomId]); // Note: gameData intentionally NOT in deps

    // ═══════════════════════════════════════════════════════════
    // 🎨 RENDER LOGIC
    // ═══════════════════════════════════════════════════════════

    // Lobby Screen
    if (!isJoined) {
        return (
            <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
                <h1 className="text-5xl font-black text-yellow-500 mb-8">TRUST MARKET</h1>
                <div className="bg-gray-800 p-8 rounded-xl border border-gray-700 w-full max-w-md space-y-4">
                    <input
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        className="w-full bg-gray-900 p-3 rounded text-white border border-gray-600"
                        placeholder="Tên của bạn"
                    />
                    <input
                        value={inputRoomId}
                        onChange={e => setInputRoomId(e.target.value)}
                        className="w-full bg-gray-900 p-3 rounded text-white border border-gray-600 font-mono text-center font-bold"
                        placeholder="Mã Phòng (VD: 101)"
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={handleCreateRoom}
                            className="flex-1 bg-yellow-600 py-3 rounded font-bold hover:bg-yellow-500 transition"
                        >
                            TẠO PHÒNG
                        </button>
                        <button
                            onClick={handleJoinRoom}
                            className="flex-1 bg-blue-600 py-3 rounded font-bold hover:bg-blue-500 transition"
                        >
                            VÀO CHƠI
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Game Screen
    const me = gameData?.players[username];
    const myCash = me ? me.cash : 0;

    // Determine if player can answer questions
    const isTrader = (me?.role === 'TRADER') || (myRole === 'TRADER');
    const isInvestor = (me?.role === 'INVESTOR') || (myRole === 'INVESTOR');
    const canAnswer = (gameData?.currentState === 'MARKET_CHAT' || gameData?.currentState === 'CLOSING') && isTrader;

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4">

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* 📊 HEADER */}
            {/* ═══════════════════════════════════════════════════════════ */}
            <div className="w-full max-w-4xl flex justify-between items-end border-b border-gray-700 pb-4 mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-yellow-400">{username}</h2>
                    <p className="text-sm text-gray-400">
                        Room: {roomId} | Round: {gameData?.currentRound}/{gameData?.totalRounds}
                    </p>
                </div>
                <div className="text-right">
                    <div className="text-3xl font-black text-green-400">{myCash.toFixed(0) + '$'}</div>
                    <div className="px-3 py-1 rounded text-xs font-bold mt-1 bg-gray-700 inline-block">
                        {gameData?.currentState}
                    </div>
                </div>
            </div>

            {/* 🔧 FIXED: Secret Role Badge - Now Persistent */}
            {secretRole && secretRole !== 'NORMAL' && (
                <div className={`w-full max-w-4xl mb-4 p-4 rounded-lg border-2 text-center font-bold text-lg ${
                    secretRole === 'ORACLE' ? 'bg-purple-900/50 border-purple-500 text-purple-300 animate-pulse' :
                        secretRole === 'SCAMMER' ? 'bg-red-900/50 border-red-500 text-red-300 animate-pulse' :
                            'bg-gray-800 border-gray-600'
                }`}>
                    🤫 BẠN LÀ: {secretRole === 'ORACLE' ? '🔮 TIÊN TRI' : '😈 KẺ LỪA ĐẢO'}
                </div>
            )}

            {/* Debug Info (Remove in production) */}
            {// eslint-disable-next-line no-undef
                process.env.NODE_ENV === 'development' && (
                    <div className="w-full max-w-4xl mb-2 p-2 bg-gray-800 rounded text-xs font-mono text-gray-400">
                        Debug: Round={gameData?.currentRound} | Role={myRole || 'null'} | Secret={secretRole || 'null'} | RoleLocked={isRoleLocked.toString()} | AnswerLocked={isAnswerLocked.toString()}
                    </div>
                )}

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* 🎮 MAIN GAME AREA */}
            {/* ═══════════════════════════════════════════════════════════ */}
            <div className="w-full max-w-2xl flex-1 flex flex-col items-center">

                {/* ─────────────────────────────────────────────────────── */}
                {/* 1️⃣ LOBBY / WAITING */}
                {/* ─────────────────────────────────────────────────────── */}
                {(!gameData || gameData.currentState === 'WAITING') && (
                    <div className="text-center mt-20">
                        <div className="text-6xl mb-4">⏳</div>
                        <h3 className="text-xl font-bold mb-6">
                            Đang chờ người chơi... ({gameData ? Object.keys(gameData.players).length : 1})
                        </h3>
                        {gameData?.hostId === username && (
                            <button
                                onClick={handleStartGame}
                                className="bg-green-600 px-8 py-3 rounded-lg font-bold hover:scale-105 transition shadow-lg animate-pulse"
                            >
                                🚀 BẮT ĐẦU GAME
                            </button>
                        )}
                    </div>
                )}

                {/* ─────────────────────────────────────────────────────── */}
                {/* 2️⃣ BLIND BET (Role Selection) */}
                {/* ─────────────────────────────────────────────────────── */}
                {gameData && gameData.currentState === 'BLIND_BET' && (
                    <div className="w-full text-center">
                        <h2 className="text-3xl font-black text-white mb-2">CHỌN VỊ THẾ</h2>
                        <div className="text-4xl font-mono font-bold text-red-500 mb-6">
                            {gameData.timeRemaining}s
                        </div>

                        {/* Bet Amount Slider */}
                        <div className="bg-gray-800 p-4 rounded-xl mb-6">
                            <div className="text-3xl font-bold text-green-400 mb-2">{betAmount + '$'}</div>
                            <input
                                type="range"
                                min="100"
                                max={myCash}
                                step="50"
                                value={betAmount}
                                onChange={(e) => setBetAmount(Number(e.target.value))}
                                disabled={isRoleLocked}
                                className="w-full accent-yellow-500"
                            />
                        </div>

                        {/* Role Selection Buttons */}
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => handleSelectRole('TRADER')}
                                disabled={isRoleLocked}
                                className={`p-8 rounded-2xl border-4 transition-all ${
                                    myRole === 'TRADER'
                                        ? 'bg-red-900 border-red-500 scale-105'
                                        : isRoleLocked
                                            ? 'bg-gray-900 border-gray-700 opacity-50 cursor-not-allowed'
                                            : 'bg-gray-800 border-gray-600 hover:border-red-400 hover:scale-105'
                                }`}
                            >
                                <div className="text-4xl mb-2">🔥</div>
                                <div className="text-2xl font-black text-red-400">TRADER</div>
                                <p className="text-xs text-gray-400 mt-2">Tự trả lời - Rủi ro cao</p>
                                {myRole === 'TRADER' && (
                                    <div className="mt-2 text-green-400 font-bold animate-pulse">✓ ĐÃ CHỌN</div>
                                )}
                            </button>

                            <button
                                onClick={() => handleSelectRole('INVESTOR')}
                                disabled={isRoleLocked}
                                className={`p-8 rounded-2xl border-4 transition-all ${
                                    myRole === 'INVESTOR'
                                        ? 'bg-blue-900 border-blue-500 scale-105'
                                        : isRoleLocked
                                            ? 'bg-gray-900 border-gray-700 opacity-50 cursor-not-allowed'
                                            : 'bg-gray-800 border-gray-600 hover:border-blue-400 hover:scale-105'
                                }`}
                            >
                                <div className="text-4xl mb-2">💎</div>
                                <div className="text-2xl font-black text-blue-400">INVESTOR</div>
                                <p className="text-xs text-gray-400 mt-2">Đầu tư - Ăn theo</p>
                                {myRole === 'INVESTOR' && (
                                    <div className="mt-2 text-green-400 font-bold animate-pulse">✓ ĐÃ CHỌN</div>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* ─────────────────────────────────────────────────────── */}
                {/* 3️⃣ ROLE ASSIGN (Animation) */}
                {/* ─────────────────────────────────────────────────────── */}
                {gameData && gameData.currentState === 'ROLE_ASSIGN' && (
                    <div className="text-center mt-20 animate-bounce">
                        <div className="text-6xl mb-4">🎲</div>
                        <h2 className="text-2xl font-bold text-yellow-400">HỆ THỐNG ĐANG PHÂN VAI...</h2>
                        <p className="text-gray-400">Ai là Tiên Tri? Ai là Kẻ Lừa Đảo?</p>
                    </div>
                )}

                {/* ─────────────────────────────────────────────────────── */}
                {/* 4️⃣ MARKET CHAT + CLOSING (Question & Investment) */}
                {/* ─────────────────────────────────────────────────────── */}
                {gameData && (gameData.currentState === 'MARKET_CHAT' || gameData.currentState === 'CLOSING') && (
                    <div className="w-full space-y-6">

                        {/* Timer Bar */}
                        <div className="flex justify-between items-center bg-gray-800 p-4 rounded-lg">
                            <span className="font-bold text-yellow-500">SÀN GIAO DỊCH</span>
                            <span className="text-3xl font-mono font-bold text-red-500">
                                {gameData.timeRemaining}s
                            </span>
                        </div>

                        {/* 🔧 FIXED: Oracle Hint - Now Always Visible When Applicable */}
                        {secretRole === 'ORACLE' && gameData.currentQuestion?.correctAnswer && (
                            <div className="bg-purple-900/50 border-2 border-purple-500 p-4 rounded-xl text-center animate-pulse">
                                <div className="text-purple-300 font-bold text-lg mb-2">
                                    🔮 GỢI Ý TỪ TIÊN TRI
                                </div>
                                <div className="text-3xl font-black text-purple-200">
                                    Đáp án đúng là: {gameData.currentQuestion.correctAnswer}
                                </div>
                                <div className="text-xs text-purple-400 mt-2">
                                    (Chỉ bạn nhìn thấy thông tin này)
                                </div>
                            </div>
                        )}

                        {/* Question Section */}
                        {gameData.currentQuestion ? (
                            <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
                                <h3 className="text-xl font-medium mb-4">
                                    {gameData.currentQuestion.question}
                                </h3>

                                {/* Answer Options */}
                                <div className="grid grid-cols-1 gap-3">
                                    {gameData.currentQuestion.options.map(opt => {
                                        const optionLetter = opt.charAt(0);
                                        const isSelected = selectedAnswer === optionLetter;
                                        const isDisabled = !canAnswer || isAnswerLocked;

                                        return (
                                            <button
                                                key={opt}
                                                onClick={() => handleSelectAnswer(opt)}
                                                disabled={isDisabled}
                                                className={`p-4 text-left rounded-lg font-bold border-l-4 transition-all ${
                                                    isSelected
                                                        ? 'bg-yellow-600 border-yellow-300 scale-105'
                                                        : isDisabled
                                                            ? 'bg-gray-800 opacity-50 cursor-not-allowed border-gray-600'
                                                            : 'bg-gray-700 border-gray-500 hover:bg-gray-600 hover:border-yellow-500'
                                                }`}
                                            >
                                                {opt}
                                                {isSelected && (
                                                    <span className="ml-2 text-green-300 animate-pulse">✓ ĐÃ CHỌN</span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {!canAnswer && isInvestor && (
                                    <p className="text-center text-xs text-gray-500 mt-4">
                                        Chỉ Trader trả lời. Bạn hãy chọn Trader để đầu tư!
                                    </p>
                                )}

                                {!canAnswer && !isInvestor && !isTrader && (
                                    <p className="text-center text-xs text-gray-500 mt-4">
                                        Bạn chưa chọn vai trò
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 text-center">
                                <div className="text-4xl mb-4 animate-spin">⏳</div>
                                <p className="text-gray-400">Đang tải câu hỏi từ AI...</p>
                            </div>
                        )}

                        {/* Trader List (For Investors) */}
                        {isInvestor && (
                            <div className="bg-gray-900 p-4 rounded-xl border border-blue-900">
                                <h4 className="text-blue-400 font-bold mb-3">CHỌN TRADER ĐỂ RÓT VỐN:</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    {tradersList.map(t => (
                                        <button
                                            key={t.id}
                                            onClick={() => handleInvest(t.id)}
                                            className="flex items-center p-3 bg-gray-800 border border-gray-600 rounded-lg hover:border-green-500 hover:bg-gray-700 transition"
                                        >
                                            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-bold mr-3">
                                                {t.displayName.charAt(0)}
                                            </div>
                                            <div className="text-left">
                                                <div className="font-bold">{t.displayName}</div>
                                                <div className="text-xs text-green-400">Đang gọi vốn</div>
                                            </div>
                                        </button>
                                    ))}
                                    {tradersList.length === 0 && (
                                        <p className="text-gray-500 italic col-span-2">
                                            Chưa có dữ liệu Trader...
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ─────────────────────────────────────────────────────── */}
                {/* 5️⃣ CALCULATION */}
                {/* ─────────────────────────────────────────────────────── */}
                {gameData && gameData.currentState === 'CALCULATION' && (
                    <div className="text-center mt-20">
                        <div className="text-6xl mb-4 animate-bounce">💸</div>
                        <h2 className="text-2xl font-bold text-green-400 animate-pulse">
                            ĐANG TÍNH TIỀN...
                        </h2>
                        <p className="text-gray-400 mt-2">Vui lòng chờ kết quả</p>
                    </div>
                )}

            </div>

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* 💰 RESULTS POPUP */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {resultData && (
                <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-800 p-6 rounded-xl border-2 border-yellow-500 max-w-md w-full shadow-2xl animate-fade-in">
                        <h2 className="text-3xl font-black text-center text-yellow-400 mb-6">
                            KẾT QUẢ VÒNG {gameData?.currentRound}
                        </h2>

                        {/* Correct Answer Display */}
                        {resultData.correctAnswer && (
                            <div className="text-center mb-6 bg-gray-900 p-4 rounded-lg border border-green-500">
                                <span className="text-gray-400 text-sm uppercase">Đáp án đúng</span>
                                <span className="text-5xl font-bold text-green-400 block mt-2">
                                    {resultData.correctAnswer}
                                </span>
                            </div>
                        )}

                        {/* Results List */}
                        <div className="max-h-80 overflow-y-auto space-y-2 mb-6 pr-2">
                            {resultData.results?.map((r, i) => (
                                <div
                                    key={i}
                                    className={`flex justify-between items-center p-3 rounded transition ${
                                        r.playerId === username
                                            ? 'bg-yellow-900/50 border-2 border-yellow-500'
                                            : 'bg-gray-700/50 hover:bg-gray-700'
                                    }`}
                                >
                                    <div>
                                        <div className="font-bold text-white">
                                            {r.displayName}
                                            {r.playerId === username && (
                                                <span className="ml-2 text-xs bg-yellow-600 px-2 py-1 rounded">BẠN</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-gray-400">{r.reason}</div>
                                    </div>
                                    <span className={`font-mono font-bold text-lg ${r.profitLoss >= 0 ? "text-green-400" : "text-red-500"}`}>
                                        {(r.profitLoss > 0 ? '+' : '') + Number(r.profitLoss).toFixed(0) + '$'}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Close Button */}
                        <button
                            onClick={() => setResultData(null)}
                            className="w-full bg-yellow-600 py-4 rounded-lg font-bold text-xl hover:bg-yellow-500 transition shadow-lg"
                        >
                            TIẾP TỤC 🔥
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default App