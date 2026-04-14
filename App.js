import { useEffect, useRef, useState, useCallback } from "react";
import { StyleSheet, Text, View, TextInput, Pressable } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-better-haptics";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 振動パターン定義 ---
// Core Haptics: vibrateAsync / playContinuousAsync で強度・シャープネス・長さを制御

// AHAPパターン: Transient（瞬間的な衝撃）とContinuous（持続振動）を重ねて最大の振動を出す
function makeAHAP(events) {
  return { Pattern: events.map((e) => ({ Event: e })) };
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

// リズム（パルス数・間隔）で方向を区別する
// 全て最大強度。違いは「回数」と「テンポ」
async function vibratePattern(direction, intensity) {
  if (direction === "STOP") return;

  switch (direction) {
    case "LEFT":
      // 1回 長いバズ (0.6秒)
      await Haptics.playAHAPAsync(makeAHAP([
        transient(0, 1.0, 1.0),
        continuous(0, 0.6, 1.0, 1.0),
      ]));
      break;

    case "RIGHT":
      // 2回 短いバズ (トッ・トッ)
      await Haptics.playAHAPAsync(makeAHAP([
        transient(0, 1.0, 1.0),
        continuous(0, 0.15, 1.0, 1.0),
        transient(0.4, 1.0, 1.0),
        continuous(0.4, 0.15, 1.0, 1.0),
      ]));
      break;

    case "UP":
      // 3回 速いパルス (トトト)
      await Haptics.playAHAPAsync(makeAHAP([
        transient(0, 1.0, 1.0),
        continuous(0, 0.1, 1.0, 1.0),
        transient(0.2, 1.0, 1.0),
        continuous(0.2, 0.1, 1.0, 1.0),
        transient(0.4, 1.0, 1.0),
        continuous(0.4, 0.1, 1.0, 1.0),
      ]));
      break;

    case "DOWN":
      // 1回 超長いバズ (1.2秒) -- LEFTの2倍の長さで明確に区別
      await Haptics.playAHAPAsync(makeAHAP([
        transient(0, 1.0, 0.3),
        continuous(0, 1.2, 1.0, 0.3),
      ]));
      break;

    case "FORWARD":
    case "ALL_ON":
      // 連続パルス (トトトトト) 5回高速
      await Haptics.playAHAPAsync(makeAHAP([
        transient(0, 1.0, 0.7),
        continuous(0, 0.08, 1.0, 0.7),
        transient(0.13, 1.0, 0.7),
        continuous(0.13, 0.08, 1.0, 0.7),
        transient(0.26, 1.0, 0.7),
        continuous(0.26, 0.08, 1.0, 0.7),
        transient(0.39, 1.0, 0.7),
        continuous(0.39, 0.08, 1.0, 0.7),
        transient(0.52, 1.0, 0.7),
        continuous(0.52, 0.08, 1.0, 0.7),
      ]));
      break;

    default:
      await Haptics.playAHAPAsync(makeAHAP([
        transient(0, 1.0, 1.0),
        continuous(0, 0.3, 1.0, 1.0),
      ]));
  }
}

// --- メインアプリ ---

export default function App() {
  const [serverIp, setServerIp] = useState("192.168.1.204");
  const [port, setPort] = useState("8765");
  const [status, setStatus] = useState("未接続");
  const [lastCommand, setLastCommand] = useState("-");
  const [commandCount, setCommandCount] = useState(0);
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
          setCommandCount((c) => c + 1);

          currentDirRef.current = dir;
          currentIntRef.current = intensity;

          if (dir === "STOP" || intensity === 0) {
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

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <Text style={styles.title}>Haptic Receiver</Text>

      <View style={styles.section}>
        <Text style={styles.label}>研究PC IP</Text>
        <TextInput
          style={styles.input}
          value={serverIp}
          onChangeText={setServerIp}
          keyboardType="numeric"
          editable={!isConnected}
        />
        <Text style={styles.label}>Port</Text>
        <TextInput
          style={styles.input}
          value={port}
          onChangeText={setPort}
          keyboardType="numeric"
          editable={!isConnected}
        />
      </View>

      <Pressable
        style={[styles.btn, { backgroundColor: isConnected ? "#F44336" : "#2196F3" }]}
        onPress={isConnected ? disconnect : connect}
      >
        <Text style={styles.btnText}>{isConnected ? "切断" : "接続"}</Text>
      </Pressable>

      <View style={styles.statusBox}>
        <Text style={[styles.statusText, { color: statusColor }]}>{status}</Text>
        <Text style={styles.info}>最後のコマンド: {lastCommand}</Text>
        <Text style={styles.info}>受信数: {commandCount}</Text>
      </View>

      <Text style={styles.label}>振動テスト</Text>
      <View style={styles.testRow}>
        {["LEFT", "RIGHT", "UP", "DOWN", "FORWARD"].map((dir) => (
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
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 30,
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
