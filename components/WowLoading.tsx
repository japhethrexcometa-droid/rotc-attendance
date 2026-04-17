import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, Easing, Text, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export default function WowLoading() {
  const scale = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in
    Animated.timing(opacity, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();

    // Breathing effect
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.05,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.95,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Glow effect
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.4,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [scale, opacity, glow]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#0F2016", "#1F3D2B"]}
        style={StyleSheet.absoluteFillObject}
      />
      <Animated.View style={[styles.glowRing, { opacity: glow, transform: [{ scale: glow.interpolate({ inputRange: [0.4, 1], outputRange: [0.8, 1.2] }) }] }]} />
      
      <Animated.View style={[styles.logoContainer, { opacity, transform: [{ scale }] }]}>
        <Animated.Image
          source={require("../assets/images/batch-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>
      <Animated.Text style={[styles.text, { opacity }]}>
        INITIALIZING CORE SYSTEMS...
      </Animated.Text>
    </View>
  );
}

const { width } = Dimensions.get("window");
const logoSize = Math.min(width * 0.4, 200);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0F2016",
  },
  logoContainer: {
    width: logoSize,
    height: logoSize,
    borderRadius: logoSize / 2,
    backgroundColor: "#FFF",
    padding: 10,
    justifyContent: "center",
    alignItems: "center",
    elevation: 20,
    shadowColor: "#D4A353",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    zIndex: 2,
  },
  logo: {
    width: "100%",
    height: "100%",
    borderRadius: logoSize / 2,
  },
  glowRing: {
    position: "absolute",
    width: logoSize * 1.5,
    height: logoSize * 1.5,
    borderRadius: logoSize * 0.75,
    backgroundColor: "rgba(212, 163, 83, 0.2)",
    zIndex: 1,
  },
  text: {
    marginTop: 40,
    color: "#D4A353",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 3,
    textShadowColor: "rgba(212, 163, 83, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
});
