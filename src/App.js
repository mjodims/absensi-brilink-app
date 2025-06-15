import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
// Import `indexedDBLocalPersistence` dan `setPersistence`
import { getAuth, signInAnonymously, onAuthStateChanged, indexedDBLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, where, getDocs } from 'firebase/firestore';

// Load SheetJS (XLSX library) from CDN
const loadXlsxScript = () => {
  return new Promise((resolve, reject) => {
    if (window.XLSX) {
      resolve(); // Already loaded
      return;
    }
    const script = document.createElement('script');
    script.src = "https://unpkg.com/xlsx/dist/xlsx.full.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

// Load jsPDF and jspdf-autotable libraries from CDN
const loadPdfScript = () => {
  return new Promise((resolve, reject) => {
    // Check if jspdf and autoTable plugin are already loaded
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.prototype.autoTable) {
      resolve(); // Already loaded
      return;
    }

    // Load jspdf first
    const script1 = document.createElement('script');
    script1.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script1.onload = () => {
      // Once jspdf is loaded, load jspdf-autotable plugin
      const script2 = document.createElement('script');
      script2.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.15/jspdf.plugin.autotable.min.js";
      script2.onload = resolve; // Resolve the promise once autotable is loaded
      script2.onerror = reject;
      document.head.appendChild(script2);
    };
    script1.onerror = reject; // Reject if jspdf fails to load
    document.head.appendChild(script1);
  });
};

// --- START Perubahan untuk Deployment Netlify ---
// Variabel-variabel ini disediakan oleh lingkungan Canvas untuk pengembangan.
// Untuk deployment ke Netlify atau lingkungan produksi lainnya, mereka tidak akan terdefinisi.
// Kita perlu menyediakan nilai fallback atau placeholder.

// ID aplikasi hardcode untuk deployment produksi.
// Ganti ini jika Anda ingin ID yang spesifik.
const appId = 'latucya-brilink-attendance-prod';

// Konfigurasi Firebase untuk deployment.
// PENTING: Nilai-nilai ini sudah diperbarui dengan konfigurasi AKTUAL dari proyek Firebase Anda.
// Aplikasi sekarang akan terhubung ke database Firebase Anda.
const firebaseConfig = {
  apiKey: "AIzaSyDnkcXvEHJWo9F2Hw18dM62npzsOByy0Tw",
  authDomain: "absensi-latucya.firebaseapp.com",
  projectId: "absensi-latucya",
  storageBucket: "absensi-latucya.firebasestorage.app",
  messagingSenderId: "177573365968",
  appId: "1:177573365968:web:eb42d8cc2aa16d9ef776d5",
  measurementId: "G-W4W0S7DYRG"
};

// initialAuthToken hanya digunakan di lingkungan Canvas untuk autentikasi kustom.
// Untuk aplikasi yang di-deploy, kita akan menggunakan signInAnonymously sebagai fallback
// atau Anda akan mengimplementasikan metode autentikasi lain (misalnya, email/password).
// Variabel ini dihapus karena tidak lagi digunakan.
// --- END Perubahan untuk Deployment Netlify ---


// Lokasi Toko Latucya BRILink
const STORE_LAT = -6.533322;
const STORE_LON = 108.455498;
const MAX_DISTANCE_METERS = 50; // Radius maksimal untuk absen
const ADMIN_PASSWORD = "120321"; // Password untuk dashboard pemilik

// Fungsi untuk menghitung jarak Haversine antara dua koordinat
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // meter
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const d = R * c; // jarak dalam meter
  return d;
};

// Komponen Notifikasi
const Notification = ({ message, type, onClose }) => {
  if (!message) return null;

  let bgColor = '';
  let textColor = '';
  switch (type) {
    case 'info':
      bgColor = 'bg-blue-100 border-blue-400 text-blue-700';
      textColor = 'text-blue-700';
      break;
    case 'success':
      bgColor = 'bg-green-100 border-green-400 text-green-700';
      textColor = 'text-green-700';
      break;
    case 'error':
      bgColor = 'bg-red-100 border-red-400 text-red-700';
      textColor = 'text-red-700';
      break;
    case 'warning':
      bgColor = 'bg-orange-100 border-orange-400 text-orange-700';
      textColor = 'text-orange-700';
      break;
    default:
      bgColor = 'bg-gray-100 border-gray-400 text-gray-700';
      textColor = 'text-gray-700';
  }

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 p-4 rounded-lg shadow-lg flex items-center justify-between transition-opacity duration-300 ease-out ${bgColor}`}
      role="alert"
    >
      <span className={`font-semibold ${textColor}`}>{message}</span>
      <button onClick={onClose} className={`ml-4 ${textColor} hover:opacity-75`}>
        &times;
      </button>
    </div>
  );
};

// Komponen Utama Aplikasi
function App() {
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null); // Firebase Auth UID
  const [currentPage, setCurrentPage] = useState('attendance'); // 'attendance' or 'dashboard'

  const [currentTime, setCurrentTime] = useState(new Date());
  const [userLocation, setUserLocation] = useState(null); // { latitude, longitude }
  const [distanceToStore, setDistanceToStore] = useState(null);
  const [attendanceStatus, setAttendanceStatus] = useState('BELUM ABSEN'); // Values: 'BELUM ABSEN', 'SUDAH ABSEN (Pukul HH:MM:SS)', 'GAGAL ABSEN'
  const [lastCheckInTime, setLastCheckInTime] = useState(null);
  const [isAbsenButtonDisabled, setIsAbsenButtonDisabled] = useState(true);
  const [showAbsenButton, setShowAbsenButton] = useState(true);

  const [notification, setNotification] = useState({ message: '', type: '' });
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [hasLocationAttemptFailed, setHasLocationAttemptFailed] = useState(false); // New state to track location errors

  // New state for location validation notification box
  const [locationValidityMessage, setLocationValidityMessage] = useState('');
  const [locationValidityType, setLocationValidityType] = useState('info'); // 'success', 'error', 'warning', 'info'
  const [countdown, setCountdown] = useState(0); // State for countdown timer
  const [isCountdownActive, setIsCountdownActive] = useState(false); // State to control countdown visibility

  // State untuk Dashboard
  const [dashboardRecords, setDashboardRecords] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [filterLoading, setFilterLoading] = useState(false);
  const [adminPassword, setAdminPassword] = useState(''); // State for password input
  const [isAuthenticatedAdmin, setIsAuthenticatedAdmin] = useState(false); // State for admin authentication
  const [exportFormat, setExportFormat] = useState(''); // State for selected export format
  const [presentDaysCount, setPresentDaysCount] = useState(0); // State baru untuk menyimpan jumlah hari hadir

  const [absenProcessStartTime, setAbsenProcessStartTime] = useState(null); // State untuk waktu mulai proses absen

  // State untuk fitur LLM
  const [llmSummary, setLlmSummary] = useState('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  // Fungsi untuk menampilkan notifikasi
  const showNotification = useCallback((message, type, duration = 5000) => {
    setNotification({ message, type });
    if (duration > 0) {
      setTimeout(() => setNotification({ message: '', type: '' }), duration);
    }
  }, []);


  // Inisialisasi Firebase dan Autentikasi dengan Persistensi
  useEffect(() => {
    try {
      if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
        console.error("Firebase config is incomplete. Please update it with your actual Firebase project details.");
        showNotification("Firebase tidak terkonfigurasi. Aplikasi mungkin tidak berfungsi penuh.", "error", 0);
        // Fallback to anonymous sign-in even if config is totally invalid
        const app = initializeApp(firebaseConfig);
        const authInstance = getAuth(app);
        const dbInstance = getFirestore(app);
        setDb(dbInstance);
        signInAnonymously(authInstance).then(userCred => setUserId(userCred.user.uid)).catch(e => console.error(e));
        setIsAuthReady(true);
        return;
      }

      const app = initializeApp(firebaseConfig);
      const authInstance = getAuth(app);
      const dbInstance = getFirestore(app);

      setDb(dbInstance);

      // --- CRITICAL CHANGE: Set persistence for the auth session ---
      setPersistence(authInstance, indexedDBLocalPersistence)
        .then(() => {
          console.log("Firebase Auth persistence set to IndexedDB Local.");
          // Now sign in anonymously or listen for state changes
          const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
            if (user) {
              setUserId(user.uid); // Gunakan UID dari Firebase Auth
              setIsAuthReady(true);
              console.log("Firebase user authenticated with UID:", user.uid);
            } else {
              try {
                console.log("No Firebase user found, signing in anonymously...");
                await signInAnonymously(authInstance);
                setUserId(authInstance.currentUser?.uid || crypto.randomUUID()); // Pastikan UID tersedia
                setIsAuthReady(true);
                console.log("Signed in anonymously with UID:", authInstance.currentUser?.uid);
              } catch (error) {
                console.error('Firebase Anonymous Auth Error:', error);
                // Fallback userId if anonymous sign-in truly fails, but it won't persist Firestore data
                setUserId(crypto.randomUUID());
                showNotification('Gagal autentikasi Firebase. Menggunakan ID sementara (data tidak akan tersimpan).', 'error');
                setIsAuthReady(true);
              }
            }
          });
          return unsubscribe; // Return cleanup function for onAuthStateChanged
        })
        .catch((error) => {
          // Handle errors if persistence cannot be set (e.g., browser not supporting IndexedDB or security errors)
          console.error("Error setting Firebase Auth persistence:", error);
          showNotification('Gagal mengatur persistensi sesi. Absensi mungkin tidak konsisten antar sesi.', 'warning');
          // Proceed without persistence, but user should be warned
          const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
            if (user) {
              setUserId(user.uid);
              setIsAuthReady(true);
            } else {
              signInAnonymously(authInstance).then(userCred => setUserId(userCred.user.uid)).catch(e => console.error(e));
              setIsAuthReady(true);
            }
          });
          return unsubscribe; // Return cleanup function
        });
    } catch (error) {
      console.error('Error initializing Firebase:', error);
      showNotification('Gagal inisialisasi Firebase. Periksa konfigurasi.', 'error');
      setUserId(crypto.randomUUID()); // Fallback
      setIsAuthReady(true);
    }
  }, [showNotification]);


  // Set interval untuk waktu saat ini
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Mengambil lokasi pengguna
  const getLocation = useCallback(() => {
    if (!navigator.geolocation) {
      showNotification('Geolokasi tidak didukung oleh browser Anda.', 'error', 0);
      setHasLocationAttemptFailed(true);
      setLocationValidityMessage('Geolokasi tidak didukung.');
      setLocationValidityType('error');
      return;
    }

    setIsLoadingLocation(true);
    setLocationValidityMessage('Mendeteksi lokasi...');
    setLocationValidityType('info');
    showNotification('Mendeteksi lokasi Anda...', 'info', 0);
    
    // Start countdown
    let currentCountdown = 10; // Initial countdown value
    setCountdown(currentCountdown);
    setIsCountdownActive(true);
    const countdownInterval = setInterval(() => {
      currentCountdown--;
      setCountdown(currentCountdown);
      if (currentCountdown <= 0) {
        clearInterval(countdownInterval);
        setIsCountdownActive(false);
      }
    }, 1000);

    const success = (position) => {
      clearInterval(countdownInterval); // Stop countdown on success
      setIsCountdownActive(false);

      const { latitude, longitude } = position.coords;
      setUserLocation({ latitude, longitude });

      const dist = haversineDistance(
        latitude,
        longitude,
        STORE_LAT,
        STORE_LON
      );
      setDistanceToStore(dist);

      setIsLoadingLocation(false);
      setHasLocationAttemptFailed(false);
      showNotification(''); // Clear general loading notification

      if (dist <= MAX_DISTANCE_METERS) {
        setLocationValidityMessage('Lokasi Valid');
        setLocationValidityType('success');
      } else {
        setLocationValidityMessage(`Lokasi Tidak Valid (Terlalu Jauh: ${dist.toFixed(1)} meter)`);
        setLocationValidityType('error');
      }
    };

    const error = (err) => {
      clearInterval(countdownInterval); // Stop countdown on error
      setIsCountdownActive(false);

      console.error('Error getting location:', err);
      console.error('Error code:', err.code, 'Error message:', err.message);

      setIsLoadingLocation(false);
      setUserLocation(null);
      setDistanceToStore(null);
      setIsAbsenButtonDisabled(true); // Disable absen button if location fails
      setHasLocationAttemptFailed(true);
      setAttendanceStatus('GAGAL ABSEN'); // Set status to failed due to location issue

      let errorMessage = 'Lokasi Tidak Ditemukan. Mohon izinkan akses lokasi di browser Anda.';
      if (err.code === err.PERMISSION_DENIED) {
        errorMessage = 'Izin lokasi ditolak. Mohon izinkan akses lokasi di browser Anda.';
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        errorMessage = 'Informasi lokasi tidak tersedia.';
      } else if (err.code === err.TIMEOUT) {
        errorMessage = 'Waktu habis untuk mendapatkan lokasi. Periksa koneksi atau GPS Anda.';
      }
      setLocationValidityMessage(errorMessage);
      setLocationValidityType('warning'); // Use warning for "not found" or permission issues
      showNotification(errorMessage, 'error', 0); // General notification, won't disappear automatically
    };

    const options = {
      enableHighAccuracy: true,
      timeout: 10000, // Reverted to 10 seconds
      maximumAge: 0,
    };

    navigator.geolocation.getCurrentPosition(success, error, options);

    // Cleanup function for useEffect (not for this specific useCallback, but good practice)
    // If this useCallback was in a useEffect, this would be relevant for unmount
    // For this case, manual clearInterval in success/error is needed.
  }, [showNotification]);

  // Periksa status absen saat komponen dimuat, userID berubah, ATAU KETIKA HALAMAN BERUBAH KE ATTENDANCE
  const checkAttendanceStatus = useCallback(async () => {
    if (!db || !userId || !isAuthReady) return;

    try {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10); // FormatYYYY-MM-DD

      const q = query(
        collection(db, `artifacts/${appId}/users/${userId}/attendance`), // Menggunakan userId (dari Firebase Auth)
        where('date', '==', todayStr)
      );
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        // Cari absensi yang berhasil untuk hari ini
        const successfulAttendance = querySnapshot.docs.find(doc => doc.data().status === 'Berhasil');

        if (successfulAttendance) {
          const docData = successfulAttendance.data();
          setAttendanceStatus(`SUDAH ABSEN (Pukul ${docData.time})`);
          // eslint-disable-next-line no-unused-vars
          setLastCheckInTime(docData.timestamp); // Line 150 (approx)
          setIsAbsenButtonDisabled(true); // Pastikan disabled jika sudah absen berhasil
          setShowAbsenButton(false);      // Pastikan tombol absen disembunyikan
          showNotification(`Anda SUDAH ABSEN hari ini pada ${docData.time}.`, 'warning');
        } else {
          // Jika ada catatan tapi tidak ada yang berhasil (semua gagal)
          setAttendanceStatus('BELUM ABSEN'); // Kembali ke BELUM ABSEN agar bisa mencoba lagi jika berada di lokasi yang benar
          setLastCheckInTime(null);
          setShowAbsenButton(true);

          // Update absen button status based on current location validity
          if (userLocation && distanceToStore !== null) {
            if (distanceToStore <= MAX_DISTANCE_METERS) {
              setIsAbsenButtonDisabled(false);
            } else {
              setIsAbsenButtonDisabled(true);
            }
          } else {
            setIsAbsenButtonDisabled(true); // Default disabled if no location info
          }
        }
      } else {
        // Jika belum ada absensi sama sekali untuk hari ini
        setAttendanceStatus('BELUM ABSEN');
        setLastCheckInTime(null);
        setShowAbsenButton(true);

        // Update absen button status based on current location validity
        if (userLocation && distanceToStore !== null) {
          if (distanceToStore <= MAX_DISTANCE_METERS) {
            setIsAbsenButtonDisabled(false); // Aktifkan jika di dalam jangkauan
          } else {
            setIsAbsenButtonDisabled(true); // Nonaktifkan jika di luar jangkauan
          }
        } else {
          setIsAbsenButtonDisabled(true); // Jika lokasi belum terdeteksi, tombol tetap disabled
        }
      }
    } catch (e) {
      console.error('Error checking attendance status:', e);
      showNotification('Gagal memeriksa status absen. Silakan coba lagi.', 'error');
    }
  }, [db, userId, isAuthReady, userLocation, distanceToStore, showNotification]);

  // Effect sentral untuk halaman attendance:
  // Memastikan checkAttendanceStatus dan getLocation dipicu dengan benar
  useEffect(() => {
    if (currentPage === 'attendance' && isAuthReady) {
      // Selalu periksa status absen dari Firebase ketika masuk ke halaman ini
      checkAttendanceStatus();

      // Dapatkan lokasi hanya jika belum ada lokasi, tidak sedang loading, dan tidak ada kegagalan permanen
      if (!userLocation && !isLoadingLocation && !hasLocationAttemptFailed) {
        getLocation();
      }
    }
  }, [currentPage, isAuthReady, userLocation, isLoadingLocation, hasLocationAttemptFailed, checkAttendanceStatus, getLocation]);


  // Handle Absen Sekarang
  const handleAbsen = async () => {
    if (!db || !userId) {
      showNotification('Aplikasi belum siap. Silakan refresh halaman.', 'error');
      return;
    }
    if (isAbsenButtonDisabled) return;

    // Validasi ulang sebelum absen
    if (!userLocation) {
      showNotification('Lokasi belum terdeteksi. Mohon tunggu. Jika terus-menerus, izinkan akses lokasi.', 'warning', 0);
      getLocation(); // Try to get location again
      return;
    }

    if (distanceToStore === null) {
        showNotification('Menghitung jarak...', 'info');
        return;
    }

    setAbsenProcessStartTime(new Date()); // Catat waktu mulai proses absen

    const currentTimestamp = new Date();
    const todayStr = currentTimestamp.toISOString().slice(0, 10); // FormatYYYY-MM-DD
    const currentTimeStr = currentTimestamp.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let status = 'Berhasil';
    let reason = null;

    // Periksa kembali status absen sebelum mencatat, untuk mencegah double absen
    const q = query(
      collection(db, `artifacts/${appId}/users/${userId}/attendance`),
      where('date', '==', todayStr),
      where('status', '==', 'Berhasil') // Hanya cari yang sudah berhasil
    );
    const existingAttendanceSnapshot = await getDocs(q);

    if (!existingAttendanceSnapshot.empty) {
        // eslint-disable-next-line no-unused-vars
        const durationSeconds = absenProcessStartTime ? ((new Date().getTime() - absenProcessStartTime.getTime()) / 1000) : 0; // Line 488 (approx)
        showNotification(
            `Anda SUDAH ABSEN hari ini pada ${currentTimeStr}. Anda hanya bisa absen sekali dalam satu hari kalender.`, // Waktu disesuaikan dengan current
            'warning',
            3000 // Notifikasi dipercepat menjadi 3 detik
        );
        setAbsenProcessStartTime(null);
        setIsAbsenButtonDisabled(true); // Pastikan tombol dinonaktifkan
        setShowAbsenButton(false); // Pastikan tombol absen disembunyikan
        return;
    }

    if (distanceToStore > MAX_DISTANCE_METERS) {
      status = 'Gagal';
      reason = 'Terlalu Jauh';
      setAttendanceStatus('GAGAL ABSEN');
      const durationSeconds = absenProcessStartTime ? ((new Date().getTime() - absenProcessStartTime.getTime()) / 1000) : 0;
      showNotification(
        `ABSEN GAGAL! Anda berada ${distanceToStore.toFixed(1)} meter dari toko (durasi: ${durationSeconds.toFixed(2)} detik). Mohon mendekat ke lokasi toko untuk absen.`,
        'error',
        3000 // Notifikasi dipercepat menjadi 3 detik
      );
      setIsAbsenButtonDisabled(true);
      setAbsenProcessStartTime(null);
      return;
    }

    try {
      setIsAbsenButtonDisabled(true);
      await addDoc(collection(db, `artifacts/${appId}/users/${userId}/attendance`), { // Menggunakan userId (dari Firebase Auth)
        timestamp: currentTimestamp.toISOString(),
        date: todayStr,
        time: currentTimeStr,
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        distanceToStore: parseFloat(distanceToStore.toFixed(1)),
        status: status,
        reason: reason,
      });

      setAttendanceStatus(`SUDAH ABSEN (Pukul ${currentTimeStr})`);
      setLastCheckInTime(currentTimestamp.toISOString());
      setShowAbsenButton(false);
      const durationSeconds = absenProcessStartTime ? ((new Date().getTime() - absenProcessStartTime.getTime()) / 1000) : 0;
      showNotification(
        `Absen Anda BERHASIL dicatat pada ${currentTimeStr} (durasi: ${durationSeconds.toFixed(2)} detik)! Terima kasih.`,
        'success',
        3000 // Notifikasi dipercepat menjadi 3 detik
      );
    } catch (e) {
      console.error('Error adding document: ', e);
      const durationSeconds = absenProcessStartTime ? ((new Date().getTime() - absenProcessStartTime.getTime()) / 1000) : 0;
      showNotification(`Gagal mencatat absen (durasi: ${durationSeconds.toFixed(2)} detik). Silakan coba lagi.`, 'error', 3000);
      setIsAbsenButtonDisabled(false);
      setShowAbsenButton(true);
      setAttendanceStatus('GAGAL ABSEN');
    } finally {
      setAbsenProcessStartTime(null);
    }
  };

  // Fungsi untuk ekspor data ke CSV
  const exportToCsv = (filename, data) => {
    if (data.length === 0) {
      showNotification('Tidak ada data untuk diekspor.', 'warning');
      return;
    }

    const headers = [
      'Hari',
      'Tanggal',
      'Waktu Absen',
      'Latitude',
      'Longitude',
      'Jarak dari Toko (m)',
      'Status',
      'Alasan',
    ];
    let csvContent = headers.join(',') + '\n';

    data.forEach((row) => {
      const rowData = [
        new Date(row.timestamp).toLocaleDateString('id-ID', { weekday: 'long' }),
        new Date(row.timestamp).toLocaleDateString('id-ID'),
        row.time,
        row.latitude,
        row.longitude,
        row.distanceToStore.toFixed(1),
        row.status,
        row.reason || '',
      ];
      csvContent += rowData.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(',') + '\n';
    });

    // Tambahkan ringkasan hari hadir
    csvContent += `\nTotal Hari Hadir: ${presentDaysCount}\n`; // Diubah ke Hari Hadir

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    showNotification('Data absensi berhasil diekspor!', 'success');
  };

  // Fungsi untuk ekspor data ke XLSX
  const exportToXlsx = async (filename, data) => {
    if (data.length === 0) {
      showNotification('Tidak ada data untuk diekspor.', 'warning');
      return;
    }

    // Load XLSX library dynamically
    try {
      await loadXlsxScript(); // Ensure the XLSX library is loaded
    } catch (error) {
      console.error('Failed to load XLSX library:', error);
      showNotification('Gagal memuat library ekspor Excel. Coba lagi nanti.', 'error');
      return;
    }

    const headers = [
      'Hari',
      'Tanggal',
      'Waktu Absen',
      'Latitude',
      'Longitude',
      'Jarak dari Toko (m)',
      'Status',
      'Alasan',
    ];

    const wsData = [headers]; // Array of arrays for worksheet data

    data.forEach((row) => {
      wsData.push([
        new Date(row.timestamp).toLocaleDateString('id-ID', { weekday: 'long' }),
        new Date(row.timestamp).toLocaleDateString('id-ID'),
        row.time,
        row.latitude,
        row.longitude,
        record.distanceToStore.toFixed(1),
        row.status,
        row.reason || '',
      ]);
    });

    // Tambahkan ringkasan hari hadir di baris paling bawah
    wsData.push([]); // Baris kosong
    wsData.push(['Total Hari Hadir:', presentDaysCount]); // Diubah ke Hari Hadir


    const ws = window.XLSX.utils.aoa_to_sheet(wsData);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Absensi Rekap");

    /* Export to XLSX */
    window.XLSX.writeFile(wb, filename);

    showNotification('Data absensi berhasil diekspor ke Excel!', 'success');
  };

  // Fungsi untuk ekspor data ke PDF
  const exportToPdf = async (filename, data) => {
    if (data.length === 0) {
      showNotification('Tidak ada data untuk diekspor.', 'warning');
      return;
    }

    try {
      await loadPdfScript(); // Ensure jsPDF and jspdf-autotable are loaded
    } catch (error) {
      console.error('Failed to load PDF library:', error);
      showNotification('Gagal memuat library ekspor PDF. Coba lagi nanti.', 'error');
      return;
    }

    const doc = new window.jspdf.jsPDF();

    // --- Watermark Section ---
    const watermarkText = "Latucya BRILink";
    const pageHeight = doc.internal.pageSize.height;
    const pageWidth = doc.internal.pageSize.width;

    doc.setFontSize(30); // Adjust font size for watermark
    doc.setTextColor(200, 200, 200); // Light grey color for subtlety
    doc.setGState(new window.jspdf.GState({ opacity: 0.1 })); // Set transparency (10% opacity)

    // Loop to draw watermarks diagonally and repeatedly
    // Adjust increments (50 and 30) for density
    for (let i = -pageHeight; i < pageWidth + pageHeight; i += 50) {
      for (let j = -pageWidth; j < pageHeight + pageWidth; j += 30) {
        doc.saveGraphicsState(); // Save current graphics state
        doc.translate(i, j); // Translate to position
        doc.rotate(45); // Rotate by 45 degrees
        doc.text(watermarkText, 0, 0); // Draw text at translated and rotated origin
        doc.restoreGraphicsState(); // Restore graphics state to not affect other elements
      }
    }
    // --- End Watermark Section ---

    // Reset opacity and text color for table content
    doc.setGState(new window.jspdf.GState({ opacity: 1 }));
    doc.setTextColor(0, 0, 0); // Black color for main content

    const tableColumn = [
        "Hari",
        "Tanggal",
        "Waktu Absen",
        "Latitude",
        "Longitude",
        "Jarak (m)",
        "Status",
        "Alasan"
    ];

    const tableRows = data.map(record => [
        new Date(record.timestamp).toLocaleDateString('id-ID', { weekday: 'long' }),
        new Date(record.timestamp).toLocaleDateString('id-ID'),
        record.time,
        record.latitude.toFixed(6),
        record.longitude.toFixed(6),
        record.distanceToStore.toFixed(1),
        record.status,
        record.reason || '',
    ]);

    // Menyiapkan data untuk ringkasan di bawah tabel
    const summaryData = [
      ['Total Hari Hadir:', presentDaysCount] // Diubah ke Hari Hadir
    ];

    doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 20,
        styles: {
            fontSize: 8,
            cellPadding: 2
        },
        headStyles: {
            fillColor: [59, 130, 246], // Tailwind blue-500
            textColor: 255, // White
            fontStyle: 'bold'
        },
        alternateRowStyles: {
            fillColor: [243, 244, 246] // Tailwind gray-100
        },
        columnStyles: {
            // Specific column width adjustments if needed
            0: { cellWidth: 15 }, // Hari
            1: { cellWidth: 20 }, // Tanggal
            2: { cellWidth: 15 }, // Waktu Absen
            3: { cellWidth: 20 }, // Latitude
            4: { cellWidth: 20 }, // Longitude
            5: { cellWidth: 15 }, // Jarak (m)
            6: { cellWidth: 15 }, // Status
            7: { cellWidth: 30 }  // Alasan
        },
        didParseCell: function (data) {
          // Add border to the last row of the table
          if (data.section === 'body' && data.row.index === tableRows.length - 1) {
            data.cell.styles.lineWidth = 0.5; // Example: Add a border for the last row
            data.cell.styles.lineColor = [0, 0, 0];
          }
        },
        didDrawPage: function(data) {
          // Get the y-coordinate of the end of the table
          let finalY = doc.autoTable.previous.finalY;

          // Add some space below the table
          finalY += 10;

          // Add summary data
          doc.setFontSize(10);
          doc.setTextColor(0, 0, 0); // Black color for summary text
          summaryData.forEach((row, index) => {
              doc.text(row[0], 14, finalY + (index * 5)); // Adjust x-coordinate (14) and spacing (5) as needed
              doc.text(String(row[1]), 80, finalY + (index * 5)); // Adjust x-coordinate (80) and spacing (5) as needed
          });
        }
    });

    doc.save(filename);
    showNotification('Data absensi berhasil diekspor ke PDF!', 'success');
  };


  // Mendapatkan rekap absensi untuk Dashboard
  const fetchDashboardRecords = useCallback(async () => {
    if (!db || !userId || !isAuthReady) {
      console.log("Firebase not ready for dashboard records.");
      return;
    }

    setFilterLoading(true);
    setDashboardRecords([]);
    setPresentDaysCount(0); // Reset count before fetching

    try {
      const startDate = new Date(selectedYear, selectedMonth - 1, 1);
      const endDate = new Date(selectedYear, selectedMonth, 0); // Last day of the month

      const q = query(
        collection(db, `artifacts/${appId}/users/${userId}/attendance`), // Menggunakan userId (dari Firebase Auth)
        where('timestamp', '>=', startDate.toISOString()),
        where('timestamp', '<=', endDate.toISOString())
      );
      const querySnapshot = await getDocs(q);
      const records = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      
      // Sort records by timestamp in descending order
      records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setDashboardRecords(records);

      // --- Logika Perhitungan Hari Hadir ---
      const successfulAttendanceDates = new Set(
        records.filter(record => record.status === 'Berhasil').map(record => record.date)
      );

      let calculatedPresentDays = 0;
      const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate(); // Total hari dalam bulan yang dipilih

      for (let i = 1; i <= daysInMonth; i++) {
        const day = i < 10 ? `0${i}` : `${i}`;
        const month = selectedMonth < 10 ? `0${selectedMonth}` : `${selectedMonth}`;
        const dateKey = `${selectedYear}-${month}-${day}`;

        // Jika pada tanggal tersebut ADA catatan absensi berhasil
        if (successfulAttendanceDates.has(dateKey)) {
          calculatedPresentDays++;
        }
      }
      setPresentDaysCount(calculatedPresentDays);
      // --- Akhir Logika Perhitungan Hari Hadir ---

    } catch (e) {
      console.error('Error fetching dashboard records:', e);
      showNotification('Gagal mengambil data rekap absensi.', 'error');
    } finally {
      setFilterLoading(false);
    }
  }, [db, userId, isAuthReady, selectedMonth, selectedYear, showNotification]);

  // Panggil fetchDashboardRecords saat bulan/tahun atau auth state berubah
  useEffect(() => {
    if (currentPage === 'dashboard' && isAuthenticatedAdmin) {
      fetchDashboardRecords();
    }
  }, [currentPage, isAuthenticatedAdmin, fetchDashboardRecords]);


  const getCurrentWIBTime = (date) => {
    // Format date part
    const dateOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    const datePart = date.toLocaleDateString('id-ID', dateOptions);

    // Format time part
    const timeOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false // Use 24-hour format
    };
    const timePart = date.toLocaleTimeString('id-ID', timeOptions);

    return `${datePart}, ${timePart} WIB`;
  };

  const handleAdminLogin = () => {
    if (adminPassword === ADMIN_PASSWORD) {
      setIsAuthenticatedAdmin(true);
      setNotification({ message: '', type: '' });
    } else {
      showNotification('Kata sandi salah!', 'error');
      setAdminPassword('');
    }
  };

  const handleAdminLogout = () => {
    setIsAuthenticatedAdmin(false);
    setAdminPassword('');
    setDashboardRecords([]);
    setCurrentPage('attendance');
  };

  const handleExport = () => {
    if (exportFormat === 'csv') {
      exportToCsv(`rekap-absensi-${selectedMonth}-${selectedYear}.csv`, dashboardRecords);
    } else if (exportFormat === 'xlsx') {
      exportToXlsx(`rekap-absensi-${selectedMonth}-${selectedYear}.xlsx`, dashboardRecords);
    } else if (exportFormat === 'pdf') {
      exportToPdf(`rekap-absensi-${selectedMonth}-${selectedYear}.pdf`, dashboardRecords);
    }
    setExportFormat('');
  };

  // Fungsi untuk menghasilkan ringkasan absensi dengan LLM (Gemini API)
  const generateAttendanceSummary = useCallback(async () => {
    if (dashboardRecords.length === 0) {
      showNotification('Tidak ada data absensi untuk diringkas.', 'warning');
      return;
    }

    setIsGeneratingSummary(true);
    setLlmSummary('');
    showNotification('Membuat ringkasan absensi dengan AI...', 'info', 0);

    try {
      const successfulCheckIns = dashboardRecords.filter(rec => rec.status === 'Berhasil').length;
      const failedCheckIns = dashboardRecords.filter(rec => rec.status === 'Gagal').length;
      const uniqueDates = new Set(dashboardRecords.map(rec => rec.date)).size;
      const totalDaysInMonth = new Date(selectedYear, selectedMonth, 0).getDate(); // Get last day of the month

      let prompt = `
        Berikut adalah data absensi karyawan untuk bulan ${new Date(selectedYear, selectedMonth - 1).toLocaleString('id-ID', { month: 'long', year: 'numeric' })}:
        Total catatan absensi: ${dashboardRecords.length}
        Absen berhasil: ${successfulCheckIns}
        Absen gagal: ${failedCheckIns}
        Jumlah hari absensi unik (ada catatan absen): ${uniqueDates}
        Total hari hadir: ${presentDaysCount}
        Total hari dalam bulan ini: ${totalDaysInMonth}
        
        Data detail setiap absensi:
        ${dashboardRecords.map(rec => `Tanggal: ${rec.date}, Waktu: ${rec.time}, Status: ${rec.status}, Jarak dari toko: ${rec.distanceToStore} meter, Alasan: ${rec.reason || 'N/A'}`).join('\n')}

        Mohon berikan ringkasan yang komprehensif dan wawasan penting (insight) dari data absensi di atas. Fokus pada:
        1. Statistik kunci (total absen, berhasil, gagal, hari unik, hari hadir).
        2. Keteraturan absensi.
        3. Jika ada absen gagal, berikan analisis singkat mengapa dan saran perbaikan.
        4. Tentukan apakah karyawan tersebut menunjukkan kinerja absensi yang baik atau perlu perhatian.
        Sajikan dalam bahasa Indonesia yang formal dan mudah dipahami, dalam format paragraf yang terstruktur.
      `;

      let chatHistory = [];
      chatHistory.push({ role: "user", parts: [{ text: prompt }] });
      
      const payload = { contents: chatHistory };
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const text = result.candidates[0].content.parts[0].text;
        setLlmSummary(text);
        showNotification('Ringkasan absensi berhasil dibuat!', 'success');
        setShowSummaryModal(true);
      } else {
        console.error('Unexpected API response structure:', result);
        showNotification('Gagal mendapatkan ringkasan dari AI. Format respons tidak sesuai.', 'error');
      }
    } catch (e) {
      console.error('Error generating summary with LLM:', e);
      showNotification('Terjadi kesalahan saat memanggil AI. Silakan coba lagi.', 'error');
    } finally {
      setIsGeneratingSummary(false);
    }
  }, [dashboardRecords, selectedMonth, selectedYear, showNotification, presentDaysCount]);


  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-blue-700 font-inter text-gray-800 flex flex-col items-center p-4">
      <Notification
        message={notification.message}
        type={notification.type}
        onClose={() => setNotification({ message: '', type: '' })}
      />

      {/* Modal Ringkasan Absensi AI */}
      {showSummaryModal && (
        <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-blue-800">✨ Ringkasan Absensi AI</h2>
              <button
                onClick={() => setShowSummaryModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                &times;
              </button>
            </div>
            {isGeneratingSummary ? (
              <p className="text-center text-gray-600">Memuat ringkasan...</p>
            ) : llmSummary ? (
              <div className="prose max-w-none">
                {/* using 'pre-wrap' to respect newline characters from LLM response */}
                <p className="whitespace-pre-wrap text-gray-700">{llmSummary}</p>
              </div>
            ) : (
              <p className="text-center text-gray-600">Tidak ada ringkasan yang tersedia.</p>
            )}
          </div>
        </div>
      )}


      {/* Header Aplikasi */}
      <header className="w-full max-w-lg bg-white rounded-lg shadow-xl p-6 mb-6 text-center">
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold uppercase text-black mb-2">Aplikasi Absensi Karyawan</h1>
        <h2 className="text-4xl md:text-5xl lg:text-6xl font-semibold leading-tight">
          <span style={{ color: '#004F98', fontWeight: 'bold' }}>Latucya</span> <span className="text-orange-600 font-bold">BRILink</span>
        </h2>
      </header>

      {/* Navigasi (Sederhana) */}
      <div className="w-full max-w-lg bg-white rounded-xl shadow-md p-4 mb-6 flex justify-around gap-x-4">
        <button
          onClick={() => {
            setCurrentPage('attendance');
            setIsAuthenticatedAdmin(false); // Reset admin auth when navigating away
            setAdminPassword('');
            // Reset location states and force re-detection when returning to attendance page
            setUserLocation(null);
            setDistanceToStore(null);
            setHasLocationAttemptFailed(false);
            setLocationValidityMessage(''); // Clear location validity message
            setLocationValidityType('info'); // Reset location validity type
            showNotification('', ''); // Clear any lingering notifications
          }}
          className={`px-6 py-3 sm:px-8 sm:py-4 rounded-xl font-semibold text-xl sm:text-2xl transition-all duration-300 ${
            currentPage === 'attendance'
              ? 'bg-orange-500 text-white shadow-lg'
              : 'bg-gray-200 text-gray-700 hover:bg-orange-100'
          }`}
        >
          Absensi Karyawan
        </button>
        <button
          onClick={() => setCurrentPage('dashboard')}
          className={`px-6 py-3 sm:px-8 sm:py-4 rounded-xl font-semibold text-xl sm:text-2xl transition-all duration-300 ${
            currentPage === 'dashboard'
              ? 'bg-orange-500 text-white shadow-lg'
              : 'bg-gray-200 text-gray-700 hover:bg-orange-100'
          }`}
        >
          Dashboard Pemilik
        </button>
      </div>

      {/* Konten Halaman */}
      {currentPage === 'attendance' ? (
        // Halaman Absensi Karyawan
        <main className="w-full max-w-lg bg-white rounded-lg shadow-xl p-6">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Informasi Real-time:</h3>
            <p className="text-md text-gray-600">
              <span className="font-medium">Waktu Saat Ini:</span>{' '}
              {getCurrentWIBTime(currentTime)}
            </p>
            <p className="text-md text-gray-600">
              <span className="font-medium">Koordinat Anda:</span>{' '}
              {userLocation
                ? `${userLocation.latitude.toFixed(6)}, ${userLocation.longitude.toFixed(6)}`
                : (hasLocationAttemptFailed ? 'Gagal deteksi lokasi' : 'Mendeteksi...')}
            </p>
            <p className="text-md text-gray-600">
              <span className="font-medium">Jarak ke Toko:</span>{' '}
              {isLoadingLocation
                ? `... ${isCountdownActive ? `(${countdown} detik)` : ''}` // Added countdown here
                : distanceToStore !== null
                ? `${distanceToStore.toFixed(1)} meter`
                : (hasLocationAttemptFailed ? 'Tidak terdeteksi' : 'Mendeteksi...')}
            </p>
          </div>

          {/* Location Validity Notification Box */}
          {locationValidityMessage && (
            <div
              className={`p-3 rounded-lg mb-4 shadow-md transition-all duration-300 border-l-4 ${
                locationValidityType === 'success' ? 'bg-green-100 border-green-500' :
                locationValidityType === 'error' ? 'bg-red-100 border-red-500' :
                locationValidityType === 'warning' ? 'bg-orange-100 border-orange-500' :
                'bg-blue-100 border-blue-500' // Default info
              }`}
            >
              <p className="text-base font-bold text-gray-800">
                Status Lokasi: <br />
                {locationValidityMessage}
              </p>
            </div>
          )}

          <div
            className={`p-4 rounded-lg mb-6 shadow-md transition-all duration-300 ${
              attendanceStatus.includes('BELUM ABSEN')
                ? 'bg-amber-100 border-l-4 border-amber-500' // Kuning
                : attendanceStatus.includes('SUDAH ABSEN')
                ? 'bg-green-100 border-l-4 border-green-500' // Hijau
                : 'bg-red-100 border-l-4 border-red-500' // Merah (for GAGAL ABSEN)
            }`}
          >
            <p className="text-lg font-bold text-gray-800">
              Status Absen Hari Ini: <br />
              {attendanceStatus}
            </p>
          </div>

          {showAbsenButton ? (
            <button
              onClick={handleAbsen}
              disabled={isAbsenButtonDisabled || isLoadingLocation}
              className={`w-full py-4 px-6 rounded-xl text-white text-xl font-bold shadow-lg transition-all duration-300
              ${
                isAbsenButtonDisabled || isLoadingLocation
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-opacity-50'
              }`}
            >
              {isLoadingLocation ? 'Mendeteksi Lokasi...' : 'Absen Sekarang'}
            </button>
          ) : (
            <button
              onClick={() => {
                // Saat tombol "Kembali ke Halaman Utama" diklik
                // Cukup ubah halaman, reset status lokasi untuk memaksa deteksi ulang.
                setCurrentPage('attendance'); // Ini sebenarnya tidak berubah, tapi memastikan efek terpanggil
                setIsAbsenButtonDisabled(true); // Default disabled sampai status valid
                setShowAbsenButton(true); // Tampilkan tombol absen lagi
                setUserLocation(null); // Reset lokasi untuk memaksa re-get
                setDistanceToStore(null); // Reset jarak
                setHasLocationAttemptFailed(false); // Reset status gagal lokasi
                setLocationValidityMessage(''); // Clear location validity message
                setLocationValidityType('info'); // Reset location validity type
                showNotification('', ''); // Hapus notifikasi lama
                // getLocation() dan checkAttendanceStatus() akan terpanggil melalui useEffect
              }}
              className="w-full py-4 px-6 rounded-xl bg-blue-600 text-white text-xl font-bold shadow-lg hover:bg-blue-700 transition-all duration-300"
            >
              Kembali ke Halaman Utama
            </button>
          )}

          <p className="text-xs text-gray-500 mt-4 text-center">
            * Absen hanya bisa dilakukan satu kali per hari dalam radius yang dekat dengan toko.
          </p>
        </main>
      ) : (
        // Dashboard Web Pemilik Toko
        <main className="w-full max-w-xl bg-white rounded-lg shadow-xl p-6">
          {!isAuthenticatedAdmin ? (
            <div className="flex flex-col items-center justify-center p-6">
              <h3 className="text-2xl font-bold text-blue-800 mb-4">Akses Dashboard Pemilik</h3>
              <input
                type="password"
                placeholder="Masukkan Kata Sandi"
                className="w-full max-w-xs p-3 border border-gray-300 rounded-xl mb-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleAdminLogin();
                  }
                }}
              />
              <button
                onClick={handleAdminLogin}
                className="w-full max-w-xs py-3 px-6 rounded-xl bg-orange-500 text-white font-semibold shadow-lg hover:bg-orange-600 transition-all duration-300"
              >
                Masuk
              </button>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-blue-800">
                  Rekap Absensi Karyawan
                </h3>
                <button
                  onClick={handleAdminLogout}
                  className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold shadow-md hover:bg-red-600 transition-all duration-300"
                >
                  Logout
                </button>
              </div>

              {/* Filter Rekap Absen */}
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <select
                  className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                >
                  {[...Array(12).keys()].map((i) => (
                    <option key={i + 1} value={i + 1}>
                      {new Date(0, i).toLocaleString('id-ID', { month: 'long' })}
                    </option>
                  ))}
                </select>
                <select
                  className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                >
                  {[...Array(5).keys()].map((i) => (
                    <option key={new Date().getFullYear() - i} value={new Date().getFullYear() - i}>
                      {new Date().getFullYear() - i}
                    </option>
                  ))}
                </select>
                <button
                  onClick={fetchDashboardRecords}
                  disabled={filterLoading}
                  className={`w-full sm:w-auto px-6 py-3 rounded-xl text-white font-semibold transition-all duration-300 ${
                    filterLoading
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                  }`}
                >
                  {filterLoading ? 'Memuat...' : 'Tampilkan Rekap'}
                </button>
              </div>

              {/* Ringkasan Statistik */}
              <div className="bg-gray-100 rounded-lg p-4 mb-6 shadow-inner">
                <h4 className="text-lg font-bold text-gray-700 mb-2">
                  Statistik {new Date(selectedYear, selectedMonth - 1).toLocaleString('id-ID', { month: 'long', year: 'numeric' })}:
                </h4>
                <p className="text-md text-gray-600">
                  <span className="font-medium">Total Hari Hadir:</span>{' '}
                  <span className="font-bold text-green-600">{presentDaysCount} hari</span>
                  <span className="text-sm text-gray-500 ml-2">(Hari dengan setidaknya satu absen berhasil)</span>
                </p>
              </div>

              {/* Tampilan Rekap Absen */}
              <div className="mb-6 max-h-96 overflow-y-auto custom-scrollbar">
                {dashboardRecords.length === 0 && !filterLoading ? (
                  <p className="text-center text-gray-500">Tidak ada data absensi untuk periode ini.</p>
                ) : filterLoading ? (
                    <p className="text-center text-gray-500">Memuat data...</p>
                ) : (
                  <div className="grid gap-4">
                    {dashboardRecords.map((record) => (
                      <div
                        key={record.id}
                        className={`p-4 rounded-lg shadow-sm border-l-4 ${
                          record.status === 'Berhasil'
                            ? 'bg-green-50 border-green-500'
                            : 'bg-red-50 border-red-500'
                        }`}
                      >
                        <p className="text-sm font-bold text-gray-800 mb-1">
                          {new Date(record.timestamp).toLocaleDateString('id-ID', {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </p>
                        <p className="text-md text-gray-700">
                          <span className="font-medium">Waktu Absen:</span> {record.time}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Koordinat:</span>{' '}
                          {record.latitude.toFixed(6)}, {record.longitude.toFixed(6)}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Jarak ke Toko:</span>{' '}
                          {record.distanceToStore.toFixed(1)} meter
                        </p>
                        <p className="text-sm text-gray-700">
                          <span className="font-medium">Status:</span>{' '}
                          <span
                            className={`font-semibold ${
                              record.status === 'Berhasil' ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {record.status}
                          </span>
                          {record.reason && (
                            <span className="ml-2 text-gray-500">({record.reason})</span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Fitur Ekspor Data (Dropdown) */}
              <div className="flex flex-col sm:flex-row gap-4 mt-6">
                <select
                  className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  disabled={dashboardRecords.length === 0}
                >
                  <option value="">Pilih Format Ekspor</option>
                  <option value="csv">Ekspor Rekap (CSV)</option>
                  <option value="xlsx">Ekspor Rekap (XLSX)</option>
                  <option value="pdf">Ekspor Rekap (PDF)</option>
                </select>
                <button
                  onClick={handleExport}
                  disabled={dashboardRecords.length === 0 || !exportFormat}
                  className={`w-full sm:w-auto py-3 px-6 rounded-xl text-white text-lg font-bold shadow-lg transition-all duration-300 ${
                    dashboardRecords.length === 0 || !exportFormat
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-opacity-50'
                  }`}
                >
                  Ekspor
                </button>
              </div>

              {/* Tombol Ringkasan Absensi AI */}
              <button
                onClick={generateAttendanceSummary}
                disabled={dashboardRecords.length === 0 || isGeneratingSummary}
                className={`w-full py-3 px-6 rounded-xl text-white text-lg font-bold shadow-lg transition-all duration-300 mt-4
                  ${
                    dashboardRecords.length === 0 || isGeneratingSummary
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700 active:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-opacity-50'
                  }`}
              >
                {isGeneratingSummary ? 'Membuat Ringkasan...' : '✨ Buat Ringkasan Absensi'}
              </button>
            </>
          )}
        </main>
      )}

      {/* Footer Aplikasi */}
      <footer className="w-full max-w-lg mt-8 text-center text-gray-200 text-sm">
        Dikembangkan oleh Muhammad Jodi Marties Seviadi
      </footer>
    </div>
  );
}

export default App;
