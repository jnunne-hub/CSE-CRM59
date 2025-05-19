// Importation des modules de chaque vue
import { initUploadView } from './views/upload.js';
import { initDashboardView } from './views/dashboard.js';
import { initChartsView, cleanupChartsView } from './views/charts.js'; // cleanupChartsView pour détruire le graphique
import { initManagePersonsView } from './views/managePersons.js';

// Configuration et initialisation Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDOE_q0XyT8sBmUU75zxGwZr2U4g3INr8M", // Remplacez par votre véritable clé API
    authDomain: "planning-c35d4.firebaseapp.com",
    projectId: "planning-c35d4",
    storageBucket: "planning-c35d4.firebasestorage.app",
    messagingSenderId: "767769918408",
    appId: "1:767769918408:web:98b4ebee1f366adea61efd"
};

export let db; // Instance Firestore globale, exportée pour être utilisable par les modules de vue
if (typeof firebase !== 'undefined') {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        console.log("Firebase initialisé pour la SPA.");
    } catch (e) {
        console.error("Erreur d'initialisation Firebase: ", e);
        alert("Erreur d'initialisation Firebase. Vérifiez la console.");
    }
} else {
    console.error("ALERTE: Firebase SDK n'est pas chargé.");
}

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
} else {
    console.error("ALERTE: pdf.js n'est pas chargé.");
}

// --- Logique de la SPA ---
const appContent = document.getElementById('app-content');
const navLinks = document.querySelectorAll('nav a');
let activeViewLoader = null;
let activeStatusMessage = null;

// Fonctions utilitaires globales exportées pour les vues
export function showViewLoader(show) {
    if (activeViewLoader) activeViewLoader.style.display = show ? 'block' : 'none';
}
export function setViewStatus(message) {
    if (activeStatusMessage) activeStatusMessage.textContent = message;
}

const views = {
    'upload': {
        templateId: 'template-upload',
        init: initUploadView
    },
    'dashboard': {
        templateId: 'template-dashboard',
        init: initDashboardView
    },
    'charts': {
        templateId: 'template-charts',
        init: initChartsView,
        cleanup: cleanupChartsView // Fonction de nettoyage spécifique pour les graphiques
    },
    'manage-persons': {
        templateId: 'template-manage-persons',
        init: initManagePersonsView
    }
};

let currentViewCleanup = null; // Pour stocker la fonction de cleanup de la vue actuelle

function navigateTo(hash) {
    const viewName = hash.substring(1) || 'upload';
    const viewConfig = views[viewName];

    // Exécuter la fonction de nettoyage de la vue précédente si elle existe
    if (currentViewCleanup) {
        currentViewCleanup();
        currentViewCleanup = null;
    }
    activeViewLoader = null;
    activeStatusMessage = null;

    if (viewConfig) {
        const template = document.getElementById(viewConfig.templateId);
        appContent.innerHTML = template.innerHTML;

        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${viewName}`);
        });

        activeViewLoader = appContent.querySelector('#view-loader');
        activeStatusMessage = appContent.querySelector('#statusMessage') || appContent.querySelector('#firebaseStatus');

        if (viewConfig.init) {
            viewConfig.init();
        }
        if (viewConfig.cleanup) { // Stocker la fonction de cleanup de la nouvelle vue
            currentViewCleanup = viewConfig.cleanup;
        }

    } else {
        appContent.innerHTML = '<div class="container"><h2>Page non trouvée</h2><p>La section demandée n\'existe pas.</p></div>';
        navLinks.forEach(link => link.classList.remove('active'));
    }
}

window.addEventListener('hashchange', () => navigateTo(location.hash));
document.addEventListener('DOMContentLoaded', () => {
    navigateTo(location.hash || '#upload');
});