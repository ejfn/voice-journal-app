import React, { useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  PanResponder,
  GestureResponderEvent,
} from "react-native";
import MaterialIcons from "@react-native-vector-icons/material-icons";
import { useTheme } from "../theme/ThemeContext";
import { formatNegativeCountdown, formatTimer } from "../utils/paths";

export interface PlaybackVisualizerProps {
  entryId: string;
  isPlaying: boolean;
  currentTimeSec: number;
  durationSec: number;
  waveformData?: number[];
  isDownloading?: boolean;
  onPlayPause: () => void;
  onSeek: (targetSec: number) => void;
  onSkip: (offsetSec: number) => void;
}

const BAR_WIDTH = 3.5;
const BAR_GAP = 3.5;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const WAVEFORM_BAR_COUNT = 75;

export const PlaybackVisualizer: React.FC<PlaybackVisualizerProps> = ({
  entryId: _entryId,
  isPlaying,
  currentTimeSec,
  durationSec,
  waveformData,
  isDownloading = false,
  onPlayPause,
  onSeek,
  onSkip,
}) => {
  const { colors } = useTheme();

  const [containerWidth, setContainerWidth] = useState<number>(320);
  const [trackWidth, setTrackWidth] = useState<number>(300);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [scrubPositionSec, setScrubPositionSec] = useState<number>(0);

  // Use real recorded waveform if available; otherwise display uniform neutral baseline bars
  const audioBars = useMemo(() => {
    if (waveformData && waveformData.length > 0) {
      return waveformData;
    }
    // Clean uniform bars when real amplitude is not available
    return new Array(WAVEFORM_BAR_COUNT).fill(0.2);
  }, [waveformData]);

  const safeDuration = Math.max(1, durationSec);
  const displayTime = isScrubbing ? scrubPositionSec : currentTimeSec;
  const progress = Math.min(1, Math.max(0, displayTime / safeDuration));
  const remainingSec = Math.max(0, safeDuration - displayTime);

  // Compute lead-in and lead-out padding bars so canvas is always populated on both sides
  const centerX = containerWidth / 2;
  const leadBarsCount = Math.max(1, Math.ceil(centerX / BAR_STEP));

  const paddedBars = useMemo(() => {
    const leadIn: number[] = new Array(leadBarsCount).fill(0.08);
    const leadOut: number[] = new Array(leadBarsCount).fill(0.08);
    return [...leadIn, ...audioBars, ...leadOut];
  }, [audioBars, leadBarsCount]);

  const stripWidth = audioBars.length * BAR_STEP;
  // Translation aligns the first audio bar (at index leadBarsCount) at centerX when progress = 0
  const translateX = centerX - leadBarsCount * BAR_STEP - progress * stripWidth;

  // Waveform PanResponder for interactive scrubbing
  const scrubStartSecRef = useRef<number>(0);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 3,
        onPanResponderGrant: () => {
          setIsScrubbing(true);
          scrubStartSecRef.current = currentTimeSec;
          setScrubPositionSec(currentTimeSec);
        },
        onPanResponderMove: (_, gesture) => {
          // Dragging left (negative dx) scrolls future audio to center -> seeking forward
          const deltaProgress = -gesture.dx / stripWidth;
          const target = Math.max(
            0,
            Math.min(
              safeDuration,
              scrubStartSecRef.current + deltaProgress * safeDuration,
            ),
          );
          setScrubPositionSec(target);
        },
        onPanResponderRelease: (_, gesture) => {
          const deltaProgress = -gesture.dx / stripWidth;
          const target = Math.max(
            0,
            Math.min(
              safeDuration,
              scrubStartSecRef.current + deltaProgress * safeDuration,
            ),
          );
          setIsScrubbing(false);
          onSeek(target);
        },
        onPanResponderTerminate: () => {
          setIsScrubbing(false);
        },
      }),
    [currentTimeSec, safeDuration, stripWidth, onSeek],
  );

  const handleTrackPress = (event: GestureResponderEvent) => {
    if (trackWidth <= 0) return;
    const { locationX } = event.nativeEvent;
    const ratio = Math.max(0, Math.min(1, locationX / trackWidth));
    const target = Math.round(ratio * safeDuration);
    onSeek(target);
  };

  return (
    <View
      style={[
        styles.cardContainer,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Center-Needle Waveform Box */}
      <View
        style={[
          styles.waveformCanvas,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
          },
        ]}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        {...panResponder.panHandlers}
        accessibilityLabel="Waveform audio scrubber. Drag horizontally to scrub."
      >
        {/* Horizontally scrolling waveform bars */}
        <View
          style={[
            styles.waveformStrip,
            {
              transform: [{ translateX }],
            },
          ]}
        >
          {paddedBars.map((heightFactor, index) => {
            // Determine if this bar has passed the center needle
            const isPlayed =
              index < leadBarsCount + progress * audioBars.length;
            return (
              <View
                key={index}
                style={[
                  styles.waveformBar,
                  {
                    height: Math.max(6, heightFactor * 104),
                    backgroundColor: colors.waveformActive,
                    opacity: isPlayed ? 1.0 : 0.35,
                  },
                ]}
              />
            );
          })}
        </View>

        {/* Fixed Center Playhead Needle */}
        <View
          style={[
            styles.centerNeedle,
            {
              backgroundColor: colors.text,
              left: centerX - 1,
            },
          ]}
        >
          <View
            style={[
              styles.needleCap,
              {
                backgroundColor: colors.primary,
              },
            ]}
          />
        </View>
      </View>

      {/* Mini Overview Timeline Track & Interactive Scrubber Thumb */}
      <View
        style={styles.timelineSection}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleTrackPress}
          style={styles.trackTouchArea}
          hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
          accessibilityLabel="Timeline progress bar"
          testID="playback-timeline-track"
        >
          <View
            style={[
              styles.trackBackground,
              { backgroundColor: colors.surfaceAlt },
            ]}
          >
            <View
              style={[
                styles.trackFill,
                {
                  width: `${Math.round(progress * 100)}%`,
                  backgroundColor: colors.primary,
                },
              ]}
            />
          </View>

          {/* Interactive Scrubber Thumb */}
          <View
            style={[
              styles.scrubberThumb,
              {
                left: `${Math.round(progress * 100)}%`,
                backgroundColor: colors.primary,
                borderColor: colors.surface,
              },
            ]}
          />
        </TouchableOpacity>

        {/* Dual Timestamps: Elapsed (MM:SS) & Negative Countdown (-MM:SS) */}
        <View style={styles.timestampsRow}>
          <Text
            style={[styles.timestampText, { color: colors.textMuted }]}
            testID="playback-elapsed-time"
          >
            {formatTimer(displayTime)}
          </Text>
          <Text
            style={[styles.timestampText, { color: colors.textMuted }]}
            testID="playback-remaining-time"
          >
            {formatNegativeCountdown(remainingSec)}
          </Text>
        </View>
      </View>

      {/* Enhanced Playback Controls: Replay-10, Play/Pause, Forward-10 */}
      <View style={styles.controlsRow}>
        {/* Rewind 10 Seconds */}
        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => onSkip(-10)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Rewind 10 seconds"
          testID="playback-rewind-10"
        >
          <MaterialIcons name="replay-10" size={34} color={colors.text} />
        </TouchableOpacity>

        {/* Primary Play/Pause Button */}
        <View style={styles.centerControlWrapper}>
          <TouchableOpacity
            style={[
              styles.primaryPlayButton,
              {
                backgroundColor: colors.primary,
                shadowColor: colors.primary,
              },
            ]}
            onPress={onPlayPause}
            disabled={isDownloading}
            activeOpacity={0.85}
            accessibilityLabel={
              isDownloading
                ? "Downloading Audio"
                : isPlaying
                  ? "Pause Audio"
                  : "Play Audio"
            }
            testID="playback-play-pause"
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <MaterialIcons
                name={isPlaying ? "pause" : "play-arrow"}
                size={34}
                color="#FFFFFF"
                style={!isPlaying ? { marginLeft: 3 } : undefined}
              />
            )}
          </TouchableOpacity>
          <Text style={[styles.controlLabel, { color: colors.textMuted }]}>
            {isDownloading ? "Downloading..." : isPlaying ? "Pause" : "Play"}
          </Text>
        </View>

        {/* Forward 10 Seconds */}
        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => onSkip(10)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Skip forward 10 seconds"
          testID="playback-forward-10"
        >
          <MaterialIcons name="forward-10" size={34} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  waveformCanvas: {
    height: 140,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    justifyContent: "center",
    marginBottom: 16,
  },
  waveformStrip: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
  },
  waveformBar: {
    width: BAR_WIDTH,
    marginRight: BAR_GAP,
    borderRadius: 2,
  },
  centerNeedle: {
    position: "absolute",
    top: 10,
    bottom: 10,
    width: 2,
    borderRadius: 1,
    zIndex: 10,
    alignItems: "center",
  },
  needleCap: {
    width: 6,
    height: 6,
    borderRadius: 3,
    position: "absolute",
    top: -2,
  },
  timelineSection: {
    width: "100%",
    marginBottom: 16,
  },
  trackTouchArea: {
    height: 20,
    justifyContent: "center",
    position: "relative",
  },
  trackBackground: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    width: "100%",
  },
  trackFill: {
    height: "100%",
    borderRadius: 3,
  },
  scrubberThumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    top: 3,
    marginLeft: -7,
  },
  timestampsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    paddingHorizontal: 2,
  },
  timestampText: {
    fontSize: 12.5,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.2,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingTop: 4,
    paddingBottom: 2,
  },
  skipButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  centerControlWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  primaryPlayButton: {
    width: 86,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 4,
  },
  controlLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
    letterSpacing: 0.1,
  },
});
