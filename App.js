import { useEffect, useRef, useState, useCallback } from "react";
import { StyleSheet, Text, View, TextInput, Pressable, Switch } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-better-haptics";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 振動パターン定義 ---
// Core Haptics: vibrateAsync / playContinuousAsync で強度・シャープネス・長さを制御

// AHAPパターン: Transient（瞬間的な衝撃）とContinuous（持続振動）を重ねて最大の振動を出す
function makeAHAP(events) {
  return { Pattern: events.map((e) => ({ Event: e })) };
}

// AudioCustomイベント: 低周波音を同期して知覚的に振動を強化
function audioImpact(time) {
  return {
    Time: time,
    EventType: "AudioCustom",
    EventWaveformPath: "impact_bass.wav",
    EventParameters: [
      { ParameterID: "AudioVolume", ParameterValue: 1.0 },
    ],
  };
}

function transient(time, intensity, sharpness) {
  return {
    Time: time,
    EventType: "HapticTransient",
    EventParameters: [
      { ParameterID: "HapticIntensity", ParameterValue: intensity },
      { ParameterID: "HapticSharpness", ParameterValue: sharpness },
    ],
  };
}

function continuous(time, duration, intensity, sharpness) {
  return {
    Time: time,
    EventType: "HapticContinuous",
    EventDuration: duration,
    EventParameters: [
      { ParameterID: "HapticIntensity", ParameterValue: intensity },
      { ParameterID: "HapticSharpness", ParameterValue: sharpness },
    ],
  };
}

// 方向パターン設計（先行研究ベース）
// 上下: メタファー（intensity漸増/漸減 + sharpness差）— Spence 2011, Rusconi et al. 2006
// 左右: Tactonリズム（短-長 / 長-短）— Brown, Brewster & Purchase 2005
// 全パターン300ms以内でリアルタイム性確保
async function vibratePattern(direction, intensity) {
  if (direction === "STOP") return;

  switch (direction) {
    case "UP":
      // 上昇メタファー: 全intensity最大 + AudioCustom同期 + sharpness高(鋭い=上)
      await Haptics.playAHAPAsync({
        Pattern: [
          { Event: audioImpact(0) },
          { Event: transient(0, 0.8, 1.0) },
          { Event: continuous(0.01, 0.29, 1.0, 1.0) },
          { Event: audioImpact(0.1) },
          { Event: transient(0.1, 1.0, 1.0) },
          { Event: audioImpact(0.2) },
          { Event: transient(0.2, 1.0, 1.0) },
        ],
      });
      break;

    case "DOWN":
      // 下降メタファー: 強打→減衰 + AudioCustom同期 + sharpness低(重い)
      await Haptics.playAHAPAsync({
        Pattern: [
          { Event: audioImpact(0) },
          { Event: transient(0, 1.0, 0.3) },
          { Event: continuous(0.01, 0.4, 1.0, 0.2) },
          {
            ParameterCurve: {
              ParameterID: "HapticIntensityControl",
              Time: 0.01,
              ParameterCurveControlPoints: [
                { Time: 0, ParameterValue: 1.0 },
                { Time: 0.2, ParameterValue: 0.5 },
                { Time: 0.4, ParameterValue: 0.1 },
              ],
            },
          },
        ],
      });
      break;

    case "LEFT":
      // Tactonリズム: 短→長 + AudioCustom同期 + 全intensity最大
      await Haptics.playAHAPAsync({
        Pattern: [
          { Event: audioImpact(0) },
          { Event: transient(0, 1.0, 1.0) },
          { Event: continuous(0.01, 0.03, 1.0, 1.0) },
          { Event: audioImpact(0.2) },
          { Event: transient(0.2, 1.0, 1.0) },
          { Event: continuous(0.21, 0.15, 1.0, 1.0) },
        ],
      });
      break;

    case "RIGHT":
      // Tactonリズム: 長→短 + AudioCustom同期 + 全intensity最大
      await Haptics.playAHAPAsync({
        Pattern: [
          { Event: audioImpact(0) },
          { Event: transient(0, 1.0, 1.0) },
          { Event: continuous(0.01, 0.15, 1.0, 1.0) },
          { Event: audioImpact(0.35) },
          { Event: transient(0.35, 1.0, 1.0) },
          { Event: continuous(0.36, 0.03, 1.0, 1.0) },
        ],
      });
      break;

    case "FORWARD":
    case "ALL_ON":
      // 距離フィードバック: intensityが距離に連動（近い=弱い、遠い=強い）
      await Haptics.playAHAPAsync({
        Pattern: [
          { Event: audioImpact(0) },
          { Event: transient(0, Math.max(0.4, intensity), 1.0) },
          { Event: continuous(0.01, 0.4, Math.max(0.4, intensity), 0.5) },
        ],
      });
      break;

    case "GOAL":
      // 到着パターン: goal.wav(0.15s)を3連打 + 振動
      await Haptics.playAHAPAsync({
        Pattern: [
          { Event: { Time: 0, EventType: "AudioCustom", EventWaveformPath: "goal.wav", EventParameters: [{ ParameterID: "AudioVolume", ParameterValue: 1.0 }] } },
          { Event: transient(0, 1.0, 0.5) },
          { Event: continuous(0.01, 0.14, 1.0, 0.5) },
          { Event: { Time: 0.2, EventType: "AudioCustom", EventWaveformPath: "goal.wav", EventParameters: [{ ParameterID: "AudioVolume", ParameterValue: 1.0 }] } },
          { Event: transient(0.2, 1.0, 0.5) },
          { Event: continuous(0.21, 0.14, 1.0, 0.5) },
          { Event: { Time: 0.4, EventType: "AudioCustom", EventWaveformPath: "goal.wav", EventParameters: [{ ParameterID: "AudioVolume", ParameterValue: 1.0 }] } },
          { Event: transient(0.4, 1.0, 0.5) },
          { Event: continuous(0.41, 0.14, 1.0, 0.5) },
        ],
      });
      break;

    default:
      await Haptics.playAHAPAsync({
        Pattern: [
          { Event: audioImpact(0) },
          { Event: transient(0, 1.0, 1.0) },
          { Event: continuous(0.01, 0.2, 1.0, 1.0) },
        ],
      });
  }
}

// --- メインアプリ ---

export default function App() {
  const [serverIp, setServerIp] = useState("192.168.1.204");
  const [port, setPort] = useState("8765");
  const [status, setStatus] = useState("未接続");
  const [lastCommand, setLastCommand] = useState("-");
  const [currentDir, setCurrentDir] = useState("STOP");
  const [commandCount, setCommandCount] = useState(0);
  const [goalSound, setGoalSound] = useState(true);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const currentDirRef = useRef("STOP");
  const currentIntRef = useRef(0);
  const loopRef = useRef(null);

  const startVibLoop = useCallback(() => {
    if (loopRef.current) return;
    loopRef.current = setInterval(async () => {
      const dir = currentDirRef.current;
      const int_ = currentIntRef.current;
      if (dir !== "STOP" && int_ > 0) {
        await vibratePattern(dir, int_);
      }
    }, 500);
  }, []);

  const stopVibLoop = useCallback(() => {
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const url = `ws://${serverIp}:${port}`;
    setStatus("接続中...");

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus("接続済み");
      ws.send(JSON.stringify({ type: "hello", device: "iPhone" }));
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "vibrate") {
          const dir = data.direction || "STOP";
          const intensity = data.intensity || 0;

          setLastCommand(`${dir} (${(intensity * 100).toFixed(0)}%)`);
          setCurrentDir(dir);
          setCommandCount((c) => c + 1);

          currentDirRef.current = dir;
          currentIntRef.current = intensity;

          if (dir === "GOAL") {
            stopVibLoop();
            if (goalSound) {
              await vibratePattern("GOAL", intensity);
            } else {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            await sleep(1000);
          } else if (dir === "STOP" || intensity === 0) {
            stopVibLoop();
          } else {
            await vibratePattern(dir, intensity);
            if (dir === "FORWARD" || dir === "ALL_ON") {
              startVibLoop();
            } else {
              stopVibLoop();
            }
          }
        }
      } catch (e) {
        // ignore
      }
    };

    ws.onclose = () => {
      setStatus("切断");
      stopVibLoop();
      reconnectRef.current = setTimeout(() => connect(), 3000);
    };

    ws.onerror = () => {
      setStatus("エラー");
    };

    wsRef.current = ws;
  }, [serverIp, port, startVibLoop, stopVibLoop]);

  const disconnect = useCallback(() => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    stopVibLoop();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("未接続");
  }, [stopVibLoop]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const testVibration = async (dir) => {
    await vibratePattern(dir, 1.0);
  };

  const isConnected = status === "接続済み";
  const statusColor =
    status === "接続済み" ? "#4CAF50" : status === "接続中..." ? "#FF9800" : "#F44336";

  const dirArrow = { UP: "^", DOWN: "v", LEFT: "<", RIGHT: ">", FORWARD: "O", STOP: "-", ALL_ON: "O", GOAL: "!" };
  const dirColor = { UP: "#4CAF50", DOWN: "#F44336", LEFT: "#2196F3", RIGHT: "#FF9800", FORWARD: "#9C27B0", STOP: "#555", ALL_ON: "#9C27B0", GOAL: "#FFD700" };
  const dirLabel = { UP: "UP", DOWN: "DOWN", LEFT: "LEFT", RIGHT: "RIGHT", FORWARD: "FWD", STOP: "STOP", ALL_ON: "ALL", GOAL: "GOAL!" };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.dirBox}>
        <Text style={[styles.dirArrow, { color: dirColor[currentDir] || "#555" }]}>
          {dirArrow[currentDir] || "-"}
        </Text>
        <Text style={[styles.dirLabel, { color: dirColor[currentDir] || "#555" }]}>
          {dirLabel[currentDir] || currentDir}
        </Text>
      </View>

      <View style={styles.statusRow}>
        <Text style={[styles.statusDot, { color: statusColor }]}>{status}</Text>
        <Text style={styles.info}>  {commandCount}件</Text>
      </View>

      {!isConnected && (
        <View style={styles.section}>
          <Text style={styles.label}>IP</Text>
          <TextInput
            style={styles.input}
            value={serverIp}
            onChangeText={setServerIp}
            keyboardType="numeric"
          />
          <Text style={styles.label}>Port</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            keyboardType="numeric"
          />
        </View>
      )}

      <Pressable
        style={[styles.btn, { backgroundColor: isConnected ? "#F44336" : "#2196F3" }]}
        onPress={isConnected ? disconnect : connect}
      >
        <Text style={styles.btnText}>{isConnected ? "切断" : "接続"}</Text>
      </Pressable>

      <View style={styles.soundRow}>
        <Text style={styles.label}>GOAL音</Text>
        <Switch value={goalSound} onValueChange={setGoalSound} />
      </View>

      <Text style={styles.label}>振動テスト</Text>
      <View style={styles.testRow}>
        {["LEFT", "RIGHT", "UP", "DOWN", "FORWARD", "GOAL"].map((dir) => (
          <Pressable
            key={dir}
            style={styles.testBtn}
            onPress={() => testVibration(dir)}
          >
            <Text style={styles.testBtnText}>{dir}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  dirBox: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  dirArrow: {
    fontSize: 120,
    fontWeight: "bold",
    lineHeight: 130,
  },
  dirLabel: {
    fontSize: 32,
    fontWeight: "bold",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  statusDot: {
    fontSize: 16,
    fontWeight: "bold",
  },
  soundRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  section: {
    width: "100%",
    marginBottom: 20,
  },
  label: {
    color: "#aaa",
    fontSize: 14,
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    backgroundColor: "#16213e",
    color: "#fff",
    fontSize: 18,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#0f3460",
  },
  btn: {
    width: "100%",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginVertical: 10,
  },
  btnText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  statusBox: {
    backgroundColor: "#16213e",
    width: "100%",
    padding: 16,
    borderRadius: 8,
    marginVertical: 10,
  },
  statusText: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 8,
  },
  info: {
    color: "#ccc",
    fontSize: 14,
    marginBottom: 2,
  },
  testRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  testBtn: {
    backgroundColor: "#0f3460",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  testBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
});
