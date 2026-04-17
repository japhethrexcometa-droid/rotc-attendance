import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { ArrowLeft, Camera, Download, Share2, User } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  PixelRatio,
  Platform,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import ViewShot, { captureRef } from "react-native-view-shot";
import { getSession } from "../lib/auth";
import {
  CadetIDData,
  ensureUserQrToken,
  getCadetById,
  getCadetByIdOrName,
  getDigitalIdPortalAppLink,
  getDigitalIdPortalWebLink,
  getShareableLink,
  listPublicCadets,
  uploadPhoto,
  uploadPhotoWithCredentials,
} from "../lib/digital-id-service";

const { width, height } = Dimensions.get("window");

const ID_WIDTH = Math.min(width - 32, 420);
const ID_HEIGHT = ID_WIDTH * 1.588;
const PUBLIC_LIST_LIMIT = 100;

export default function DigitalIDScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; cadetId?: string }>();
  const viewShotRef = useRef<ViewShot>(null);

  const [mode, setMode] = useState<"loading" | "cadet" | "public">("loading");
  const [cadetData, setCadetData] = useState<CadetIDData | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [publicUploadError, setPublicUploadError] = useState<string | null>(null);
  const [showMessengerBanner, setShowMessengerBanner] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [publicCadets, setPublicCadets] = useState<CadetIDData[]>([]);
  const [searchResults, setSearchResults] = useState<CadetIDData[]>([]);
  const [searching, setSearching] = useState(false);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicError, setPublicError] = useState<string | null>(null);
  const [selectedCadet, setSelectedCadet] = useState<CadetIDData | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmedSearchQuery = searchQuery.trim();
  const showingFilteredResults = trimmedSearchQuery.length > 0;
  const visibleCadets = showingFilteredResults ? searchResults : publicCadets;
  const totalCadetsLabel = useMemo(() => {
    const count = visibleCadets.length;
    return `${count} total cadet${count === 1 ? "" : "s"}`;
  }, [visibleCadets]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    (async () => {
      const session = await getSession();

      if (session && (session.role === "cadet" || session.role === "officer")) {
        const data = await getCadetById(session.id);
        if (data) {
          const token = await ensureUserQrToken(data.id, data.qr_token);
          data.qr_token = token;
        }
        setCadetData(data);
        setMode("cadet");
        return;
      }

      if (params.id || params.cadetId) {
        const targetCadetId = String(params.id || params.cadetId);
        const data = await getCadetById(targetCadetId);
        if (data) {
          const token = await ensureUserQrToken(data.id, data.qr_token);
          data.qr_token = token;
          setSelectedCadet(data);
        }
      }

      setMode("public");
    })();
  }, [params.id, params.cadetId]);

  useEffect(() => {
    if (mode !== "public") return;

    const loadInitialCadets = async () => {
      setPublicLoading(true);
      setPublicError(null);

      try {
        const cadets = await listPublicCadets(PUBLIC_LIST_LIMIT);
        setPublicCadets(cadets);
        if (!trimmedSearchQuery) {
          setSearchResults(cadets);
        }
      } catch {
        setPublicCadets([]);
        setSearchResults([]);
        setPublicError("Unable to load cadets right now.");
      } finally {
        setPublicLoading(false);
      }
    };

    loadInitialCadets();
  }, [mode, trimmedSearchQuery]);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const nextQuery = text.trim();

    if (!nextQuery) {
      setSearching(false);
      setPublicError(null);
      setSearchResults(publicCadets);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setPublicError(null);

      try {
        const results = await getCadetByIdOrName(nextQuery, PUBLIC_LIST_LIMIT);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
        setPublicError("Unable to search cadets right now.");
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const handleSelectCadet = async (cadet: CadetIDData) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const token = await ensureUserQrToken(cadet.id, cadet.qr_token);
      setSelectedCadet({ ...cadet, qr_token: token });
    } catch {
      setSelectedCadet(cadet);
    }
  };

  const handlePickPhoto = async () => {
    const activeCadet = mode === "cadet" ? cadetData : selectedCadet;
    if (!activeCadet) return;
    setPublicUploadError(null);

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      setIsUploading(true);
      try {
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        await uploadPhoto(activeCadet.id, uri);
      } catch (error) {
        console.error("Upload error:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Could not save photo to server, but it will show locally.";
        if (mode === "public") {
          setPublicUploadError(message);
        } else {
          Alert.alert("Upload Failed", message);
        }
      } finally {
        setIsUploading(false);
      }
    }
  };

  const displayCadet: CadetIDData | null =
    mode === "cadet" ? cadetData : selectedCadet;

  const handleDownload = async () => {
    try {
      if (Platform.OS === "web") {
        const isMessenger = /FBAN|FBAV|Messenger|Instagram|Snapchat/i.test(navigator.userAgent);
        
        if (isMessenger) {
          setShowMessengerBanner(true);
          return;
        }

        try {
          const html2canvas = (await import('html2canvas')).default;
          const element = document.getElementById('printable-card');
          if (element) {
            const canvas = await html2canvas(element, {
              scale: 4, // High-quality capturing
              useCORS: true,
              allowTaint: true,
              backgroundColor: '#FFFFFF',
            });
            const dataUrl = canvas.toDataURL('image/png', 1.0);
            
            const link = document.createElement('a');
            link.download = `ROTC_ID_${displayCadet?.id_number || 'Cadet'}.png`;
            link.href = dataUrl;
            link.click();
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
        } catch (e) {
          console.error("Web download error:", e);
          Alert.alert("Error", "Could not process high-quality ID. Try again or try using a different browser.");
        }
        return;
      }

      if (!viewShotRef.current) return;

      const CAPTURE_SCALE = 4;
      const uri = await captureRef(viewShotRef.current, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        width: Math.round(ID_WIDTH * PixelRatio.get() * CAPTURE_SCALE),
        height: Math.round(ID_HEIGHT * PixelRatio.get() * CAPTURE_SCALE),
      });

      await Sharing.shareAsync(uri);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Error", "Could not save ID card.");
    }
  };

  const handleShareLink = async () => {
    const cadet = mode === "cadet" ? cadetData : selectedCadet;
    if (!cadet) return;
    const webPortal = getDigitalIdPortalWebLink();
    const appPortal = getDigitalIdPortalAppLink();
    const webLink = webPortal ? getShareableLink(cadet.id) : "";
    const appSeparator = appPortal.includes("?") ? "&" : "?";
    const appLink = `${appPortal}${appSeparator}id=${encodeURIComponent(cadet.id)}`;
    await Share.share({
      message: webLink
        ? `ROTC Digital ID\n\nWeb: ${webLink}\nApp: ${appLink}`
        : `ROTC Digital ID (Open in app): ${appLink}`,
    });
  };

  if (mode === "loading") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator style={{ flex: 1 }} color="#1F3D2B" />
      </SafeAreaView>
    );
  }

  if (mode === "public" && !selectedCadet) {
    const showInitialLoader = publicLoading && publicCadets.length === 0;
    const showEmptyState =
      !showInitialLoader && !searching && visibleCadets.length === 0;
    const emptyStateTitle = showingFilteredResults
      ? "No cadets found"
      : "No cadets available";
    const emptyStateText = showingFilteredResults
      ? "Try searching with a different name or ID number."
      : "Cadet records will appear here once they are added.";

    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.6}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          >
            <ArrowLeft color="#111" size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>ROTC ID Lookup</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.publicContent}>
          <View style={styles.searchSection}>
            <Text style={styles.lookupHeading}>Find a cadet digital ID</Text>
            <Text style={styles.lookupSubheading}>
              Search by cadet name or ID number, or browse the current list
              below.
            </Text>

            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name or ID number..."
                placeholderTextColor="#A0B3A6"
                value={searchQuery}
                onChangeText={handleSearchChange}
                returnKeyType="search"
              />
              {searching && (
                <ActivityIndicator
                  style={styles.searchSpinner}
                  color="#1F3D2B"
                />
              )}
            </View>

            <View style={styles.searchMetaRow}>
              <Text style={styles.totalCount}>{totalCadetsLabel}</Text>
              {trimmedSearchQuery ? (
                <TouchableOpacity
                  onPress={() => handleSearchChange("")}
                  style={styles.clearSearchBtn}
                >
                  <Text style={styles.clearSearchText}>Clear search</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {publicError ? (
              <Text style={styles.publicErrorText}>{publicError}</Text>
            ) : null}
          </View>

          {showInitialLoader ? (
            <View style={styles.publicStateCard}>
              <ActivityIndicator color="#1F3D2B" />
              <Text style={styles.publicStateText}>Loading cadets...</Text>
            </View>
          ) : (
            <FlatList
              data={visibleCadets}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.resultsList}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                showEmptyState ? (
                  <View style={styles.emptyStateCard}>
                    <Text style={styles.emptyStateTitle}>{emptyStateTitle}</Text>
                    <Text style={styles.emptyStateText}>{emptyStateText}</Text>
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultItem}
                  onPress={() => handleSelectCadet(item)}
                  activeOpacity={0.85}
                >
                  <View style={styles.resultTextWrap}>
                    <Text style={styles.resultName}>{item.full_name}</Text>
                    <Text style={styles.resultSub}>
                      {item.id_number || "No ID number"}
                    </Text>
                    <Text style={styles.resultMeta}>
                      {item.platoon || "No platoon assigned"}
                      {item.year_level ? ` • ${item.year_level}` : ""}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.resultStatusBadge,
                      item.is_active
                        ? styles.resultStatusActive
                        : styles.resultStatusInactive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.resultStatusText,
                        item.is_active
                          ? styles.resultStatusTextActive
                          : styles.resultStatusTextInactive,
                      ]}
                    >
                      {item.is_active ? "Active" : "Inactive"}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const displayPhoto = photoUri ?? displayCadet?.photo_url ?? null;
  const isOwnCard = mode === "cadet";
  const isOfficerCard = displayCadet?.role === "officer";
  const canUploadPhoto = isOwnCard || mode === "public";

  return (
    <SafeAreaView style={styles.safeArea}>
      <View id="no-print-header" style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (mode === "public" && selectedCadet) {
              setSelectedCadet(null);
            } else {
              router.back();
            }
          }}
          style={styles.backBtn}
          activeOpacity={0.6}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
        >
          <ArrowLeft color="#111" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Digital ROTC ID</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.cardScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          <Text style={styles.instruction}>
            {isOwnCard
              ? "Present this QR code for attendance scanning."
              : "Official MSU-Zamboanga Sibugay ROTC ID."}
          </Text>

          {mode === "public" ? (
            <View style={styles.publicUploadCard}>
              <Text style={styles.publicUploadTitle}>Upload cadet photo</Text>
              <Text style={styles.publicUploadSub}>
                Click the avatar icon below to assign a photo to this ID card.
              </Text>
              
              {publicUploadError ? (
                <Text style={styles.publicUploadError}>{publicUploadError}</Text>
              ) : null}
            </View>
          ) : null}

          <ViewShot ref={viewShotRef} style={styles.idCardContainer}>
            <View id="printable-card" style={{ flex: 1 }}>
            <View style={styles.idCard}>
              <LinearGradient
                colors={["rgba(255,255,255,0.15)", "rgba(255,255,255,0)"]}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 0.5, y: 0.5 }}
              />

              <View style={styles.idHeader}>
                <View style={styles.logoCircle}>
                  <Image
                    source={require("../assets/images/rotc-logo.jpg")}
                    style={styles.headerLogo}
                    resizeMode="contain"
                  />
                </View>
                <View style={styles.headerTextGroup}>
                  <Text style={styles.headerTextSys} adjustsFontSizeToFit>
                    DEPARTMENT OF MILITARY SCIENCE AND TACTICS
                  </Text>
                  <Text style={styles.headerTextMain} adjustsFontSizeToFit>
                    MSU – Zamboanga Sibugay ROTC Unit
                  </Text>
                  <Text style={styles.headerTextLoc}>
                    Datu Panas, Buug, Zamboanga Sibugay
                  </Text>
                </View>
                <View style={styles.logoCircleGold}>
                  <Image
                    source={require("../assets/images/batch-logo.png")}
                    style={styles.headerLogo}
                    resizeMode="contain"
                  />
                </View>
              </View>

              <View style={styles.divider} />

              <LinearGradient colors={["#FFFFFF", "#F0F4F1"]} style={{ flex: 1 }}>
                <View style={styles.idBody}>
                  <TouchableOpacity
                    onPress={canUploadPhoto ? handlePickPhoto : undefined}
                    style={styles.photoContainer}
                    activeOpacity={canUploadPhoto ? 0.7 : 1}
                  >
                    {isUploading ? (
                      <ActivityIndicator color="#1F3D2B" />
                    ) : displayPhoto ? (
                      <Image
                        source={{ uri: displayPhoto }}
                        style={styles.uploadedPhoto}
                      />
                    ) : (
                      <View style={styles.photoPlaceholder}>
                        <User color="#A0B3A6" size={50} />
                        {canUploadPhoto && (
                          <View style={styles.cameraIconBadge}>
                            <Camera color="#FFF" size={12} />
                          </View>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>

                  <View style={styles.infoSection}>
                    <Text style={styles.cadetName} numberOfLines={2}>
                      {displayCadet?.full_name?.toUpperCase() ?? "—"}
                    </Text>
                    <View style={styles.idBadge}>
                      <Text style={styles.cadetIdLabel}>
                        ID NO:{" "}
                        <Text style={styles.cadetIdValue}>
                          {displayCadet?.id_number ?? "—"}
                        </Text>
                      </Text>
                    </View>
                  {isOfficerCard ? (
                    <View style={styles.officerBadge}>
                      <Text style={styles.officerBadgeText}>ROTC OFFICER</Text>
                    </View>
                  ) : null}
                  </View>

                  <View style={styles.inlineQrSection}>
                    <View style={styles.inlineQrWrapper}>
                      <QRCode
                        value={
                          displayCadet
                            ? JSON.stringify({
                                cadet_id: displayCadet.id,
                                token: displayCadet.qr_token ?? "",
                              })
                            : "INVALID"
                        }
                        size={82}
                        color="#1F3D2B"
                      />
                    </View>
                    <Text style={styles.inlineQrLabel}>ATTENDANCE SCAN QR</Text>
                  </View>

                  <View style={styles.detailsGrid}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>PLATOON</Text>
                      <Text style={styles.detailValue}>
                        {displayCadet?.platoon ?? "—"}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>YEAR / AY</Text>
                      <Text style={styles.detailValue}>
                        {displayCadet?.year_level ?? "2025-2026"}
                      </Text>
                    </View>
                    <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
                      <Text style={styles.detailLabel}>STATUS</Text>
                      <View
                        style={[
                          styles.statusBadge,
                          {
                            backgroundColor: displayCadet?.is_active
                              ? "#E8F5E9"
                              : "#FFEBEE",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusText,
                            {
                              color: displayCadet?.is_active
                                ? "#2E7D32"
                                : "#C62828",
                            },
                          ]}
                        >
                          {displayCadet?.is_active ? "ACTIVE" : "INACTIVE"}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              </LinearGradient>

              <View style={styles.idFooter}>
                <Text style={styles.footerBrand}>
                  OFFICIAL ROTC DIGITAL IDENTIFICATION
                </Text>
              </View>
            </View>
            </View>
          </ViewShot>

          {showMessengerBanner && (
            <View style={styles.messengerBanner}>
              <Text style={styles.messengerBannerTitle}>⚠️ In-App Browser Detected</Text>
              <Text style={styles.messengerBannerBody}>
                Facebook Messenger blocks HD downloads. To save your Digital ID:
              </Text>
              <View style={styles.messengerSteps}>
                <Text style={styles.messengerStep}>1️⃣  Tap the <Text style={styles.messengerStepBold}>⋯  (3-dot menu)</Text> in the top corner</Text>
                <Text style={styles.messengerStep}>2️⃣  Choose <Text style={styles.messengerStepBold}>&quot;Open in Chrome&quot;</Text> or <Text style={styles.messengerStepBold}>&quot;Open in Browser&quot;</Text></Text>
                <Text style={styles.messengerStep}>3️⃣  Then tap <Text style={styles.messengerStepBold}>&quot;Download / Print-ready PNG&quot;</Text> again</Text>
              </View>
              <TouchableOpacity
                style={styles.messengerBannerClose}
                onPress={() => setShowMessengerBanner(false)}
              >
                <Text style={styles.messengerBannerCloseText}>Got it — Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            id="no-print-download"
            style={styles.downloadBtn}
            onPress={handleDownload}
            activeOpacity={0.8}
          >
            <Download color="#FFF" size={20} style={{ marginRight: 10 }} />
            <Text style={styles.downloadBtnText}>
              Download / Print-ready PNG
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            id="no-print-share"
            style={styles.shareBtn}
            onPress={handleShareLink}
            activeOpacity={0.8}
          >
            <Share2 color="#1F3D2B" size={18} style={{ marginRight: 8 }} />
            <Text style={styles.shareBtnText}>Share ID Link</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8F9F7",
    paddingTop: Platform.OS === "android" ? 35 : 0,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },
  backBtn: { padding: 8, marginHorizontal: -8 },
  headerTitle: { fontSize: 18, fontWeight: "bold", color: "#111" },

  publicContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchSection: {
    marginBottom: 12,
  },
  lookupHeading: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1F3D2B",
  },
  lookupSubheading: {
    fontSize: 14,
    color: "#6E7A71",
    marginTop: 6,
    lineHeight: 20,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    backgroundColor: "#FFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EAECE6",
    paddingHorizontal: 14,
    minHeight: 54,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    minHeight: 54,
    fontSize: 15,
    color: "#111",
  },
  searchSpinner: { marginLeft: 8 },
  searchMetaRow: {
    marginTop: 12,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  totalCount: {
    fontSize: 14,
    color: "#1F3D2B",
    fontWeight: "700",
  },
  clearSearchBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#EAF1EC",
  },
  clearSearchText: {
    color: "#1F3D2B",
    fontWeight: "700",
    fontSize: 13,
  },
  publicErrorText: {
    marginTop: 8,
    color: "#C62828",
    fontSize: 13,
  },
  resultsList: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  resultItem: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#EAECE6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  resultTextWrap: {
    paddingRight: 86,
  },
  resultName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F3D2B",
  },
  resultSub: {
    fontSize: 13,
    color: "#4F6253",
    marginTop: 4,
    fontWeight: "600",
  },
  resultMeta: {
    fontSize: 12,
    color: "#6E7A71",
    marginTop: 5,
  },
  resultStatusBadge: {
    position: "absolute",
    top: 14,
    right: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  resultStatusActive: {
    backgroundColor: "#E8F5E9",
  },
  resultStatusInactive: {
    backgroundColor: "#FFEBEE",
  },
  resultStatusText: {
    fontSize: 11,
    fontWeight: "800",
  },
  resultStatusTextActive: {
    color: "#2E7D32",
  },
  resultStatusTextInactive: {
    color: "#C62828",
  },
  publicStateCard: {
    marginTop: 24,
    backgroundColor: "#FFF",
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#EAECE6",
  },
  publicStateText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6E7A71",
  },
  emptyStateCard: {
    marginTop: 30,
    backgroundColor: "#FFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#EAECE6",
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#1F3D2B",
    textAlign: "center",
  },
  emptyStateText: {
    marginTop: 8,
    textAlign: "center",
    color: "#6E7A71",
    fontSize: 14,
    lineHeight: 20,
  },

  cardScrollContent: {
    paddingBottom: 24,
    minHeight: height - 80,
  },
  container: { flex: 1, alignItems: "center", paddingHorizontal: 16 },
  instruction: {
    fontSize: 14,
    color: "#6E7A71",
    marginBottom: 16,
    textAlign: "center",
  },

  publicUploadCard: {
    width: "100%",
    backgroundColor: "#FFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EAECE6",
    padding: 14,
    marginBottom: 14,
  },
  publicUploadTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#1F3D2B",
  },
  publicUploadSub: {
    marginTop: 4,
    fontSize: 12,
    color: "#6E7A71",
    lineHeight: 18,
  },
  publicUploadInput: {
    marginTop: 10,
    backgroundColor: "#F8F9F7",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#EAECE6",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: "#111",
  },
  publicUploadError: {
    marginTop: 8,
    color: "#C62828",
    fontSize: 12,
    fontWeight: "700",
  },
  publicUploadHint: {
    marginTop: 8,
    color: "#4F6253",
    fontSize: 11,
    lineHeight: 16,
  },

  idCardContainer: {
    padding: 4,
    backgroundColor: "transparent",
  },
  idCard: {
    width: ID_WIDTH,
    height: ID_HEIGHT,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#EAECE6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.2,
    shadowRadius: 25,
    elevation: 15,
  },
  idHeader: {
    backgroundColor: "#1F3D2B",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  logoCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: 2,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
  logoCircleGold: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: 2,
    borderWidth: 1.5,
    borderColor: "rgba(212, 163, 83, 0.5)",
  },
  headerLogo: { width: "100%", height: "100%" },
  headerTextGroup: { flex: 1, alignItems: "center", paddingHorizontal: 6 },
  headerTextSys: {
    color: "#D4A353",
    fontSize: 7,
    fontWeight: "800",
    marginBottom: 2,
    letterSpacing: 0.8,
    textAlign: "center",
  },
  headerTextMain: {
    color: "#FFF",
    fontSize: 10.5,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 1,
    letterSpacing: 0.2,
  },
  headerTextLoc: {
    color: "rgba(160, 179, 166, 0.8)",
    fontSize: 7.2,
    marginTop: 4,
    textAlign: "center",
    fontWeight: "500",
  },

  divider: { height: 5, backgroundColor: "#D4A353", width: "100%" },

  idBody: { padding: 20, alignItems: "center" },
  photoContainer: {
    width: 96,
    height: 96,
    backgroundColor: "#F0F2ED",
    borderRadius: 48,
    borderWidth: 3,
    borderColor: "#D4A353",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    overflow: "visible",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  photoPlaceholder: { alignItems: "center", justifyContent: "center" },
  uploadedPhoto: { width: "100%", height: "100%", borderRadius: 46 },
  cameraIconBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "#D4A353",
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },

  infoSection: { alignItems: "center", marginBottom: 10 },
  cadetName: {
    fontSize: 18,
    fontWeight: "900",
    color: "#1F3D2B",
    textAlign: "center",
    letterSpacing: 0.5,
    paddingHorizontal: 10,
  },
  idBadge: {
    marginTop: 6,
    backgroundColor: "#F0F2EE",
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  cadetIdLabel: {
    fontSize: 11,
    color: "#6E7A71",
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  cadetIdValue: { color: "#111", fontWeight: "900" },
  officerBadge: {
    marginTop: 8,
    backgroundColor: "#E8EDEA",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#1F3D2B",
  },
  officerBadgeText: {
    color: "#1F3D2B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  detailsGrid: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.7)",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(234, 236, 230, 0.5)",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F2ED",
  },
  detailLabel: {
    fontSize: 10,
    color: "#8A9A8E",
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 13,
    color: "#1F3D2B",
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "right",
  },

  inlineQrSection: {
    width: "100%",
    alignItems: "center",
    marginBottom: 10,
  },
  inlineQrWrapper: {
    backgroundColor: "#FFF",
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "#EAECE6",
  },
  inlineQrLabel: {
    marginTop: 6,
    fontSize: 10,
    color: "#4A5D4E",
    fontWeight: "800",
    letterSpacing: 0.6,
  },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "900",
  },

  idFooter: {
    backgroundColor: "#1F3D2B",
    paddingVertical: 10,
    alignItems: "center",
  },
  footerBrand: {
    color: "rgba(212, 163, 83, 0.8)",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 2.2,
  },

  downloadBtn: {
    flexDirection: "row",
    backgroundColor: "#1F3D2B",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    shadowColor: "#1F3D2B",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
  },
  downloadBtnText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "bold",
    letterSpacing: 0.3,
    textAlign: "center",
  },
  shareBtn: {
    marginTop: 10,
    width: "100%",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#1F3D2B",
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    backgroundColor: "#FFF",
    marginBottom: 8,
  },
  shareBtnText: { color: "#1F3D2B", fontWeight: "800", fontSize: 15 },
  printOnly: {
    display: "none",
  },
  messengerBanner: {
    width: "100%",
    backgroundColor: "#FFF8E7",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#D4A353",
    padding: 16,
    marginBottom: 14,
    marginTop: 4,
  },
  messengerBannerTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#7A4E00",
    marginBottom: 6,
    textAlign: "center",
    letterSpacing: 0.3,
  },
  messengerBannerBody: {
    fontSize: 13,
    color: "#5A3E00",
    textAlign: "center",
    marginBottom: 12,
    fontWeight: "600",
  },
  messengerSteps: {
    gap: 6,
    marginBottom: 14,
  },
  messengerStep: {
    fontSize: 13,
    color: "#4A3800",
    lineHeight: 20,
    paddingHorizontal: 4,
  },
  messengerStepBold: {
    fontWeight: "900",
    color: "#7A4E00",
  },
  messengerBannerClose: {
    alignSelf: "center",
    backgroundColor: "#D4A353",
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 20,
  },
  messengerBannerCloseText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 13,
  },
});