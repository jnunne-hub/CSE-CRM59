// script.js (Principal)

// Importation des modules de chaque vue
import { initUploadView } from './views/upload.js';
import { initDashboardView } from './views/dashboard.js';
import { initChartsView, cleanupChartsView } from './views/charts.js';
import { initManagePersonsView } from './views/managePersons.js';

// Configuration et initialisation Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDOE_q0XyT8sBmUU75zxGwZr2U4g3INr8M", // Remplacez par votre véritable clé API
    authDomain: "planning-c35d4.firebaseapp.com", // Adaptez à votre projet Firebase
    projectId: "planning-c35d4",                 // Adaptez à votre projet Firebase
    storageBucket: "planning-c35d4.firebasestorage.app", // Adaptez à votre projet Firebase
    messagingSenderId: "767769918408",           // Adaptez à votre projet Firebase
    appId: "1:767769918408:web:98b4ebee1f366adea61efd"             // Adaptez à votre projet Firebase
};

export let db; // Instance Firestore globale, exportée pour être utilisable par les modules de vue

// Vérifier si Firebase App a déjà été initialisée pour éviter l'erreur "already initialized"
// Ceci est utile si le script est rechargé ou dans certains contextes de modules.
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        console.log("Firebase initialisé pour la SPA.");
    } catch (e) {
        console.error("Erreur d'initialisation Firebase: ", e);
        alert("Erreur d'initialisation Firebase. Vérifiez la console.");
    }
} else if (typeof firebase !== 'undefined' && firebase.apps.length) {
    // Firebase est déjà initialisé, récupérer l'instance de la base de données
    db = firebase.app().firestore();
    console.log("Firebase déjà initialisé, instance récupérée.");
} else {
    console.error("ALERTE: Firebase SDK n'est pas chargé.");
}


// Configuration pour PDF.js
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
let currentViewCleanup = null; // Pour stocker la fonction de cleanup de la vue actuelle (ex: charts)


// Fonctions utilitaires globales exportées pour les vues
export function showViewLoader(show) {
    if (activeViewLoader) {
        activeViewLoader.style.display = show ? 'block' : 'none';
    } else {
        // Tenter de trouver un loader générique si activeViewLoader n'est pas défini
        const genericLoader = document.getElementById('view-loader');
        if (genericLoader) genericLoader.style.display = show ? 'block' : 'none';
    }
}

export function setViewStatus(message, type = 'info') { // type peut être 'info', 'success', 'error'
    if (activeStatusMessage) {
        activeStatusMessage.textContent = message;
        activeStatusMessage.className = ''; // Réinitialiser les classes
        if (message) { // Ajouter la classe de type seulement si le message n'est pas vide
            activeStatusMessage.classList.add(type);
        }
    } else {
        const genericStatus = document.getElementById('statusMessage') || document.getElementById('firebaseStatus');
        if (genericStatus) {
            genericStatus.textContent = message;
            genericStatus.className = '';
            if (message) {
                genericStatus.classList.add(type);
            }
        }
    }
}


// Configuration des vues
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


// Fonction de navigation principale
function navigateTo(hash) {
    const viewName = hash.substring(1) || 'upload'; // Vue par défaut si pas de hash ou hash vide
    const viewConfig = views[viewName];

    // Exécuter la fonction de nettoyage de la vue précédente si elle existe
    if (currentViewCleanup) {
        currentViewCleanup();
        currentViewCleanup = null;
    }

    // Réinitialiser les références pour la nouvelle vue
    activeViewLoader = null;
    activeStatusMessage = null;

    if (viewConfig) {
        const template = document.getElementById(viewConfig.templateId);
        if (template) {
            appContent.innerHTML = template.innerHTML; // Injecter le contenu du template
        } else {
            console.error(`Template ${viewConfig.templateId} non trouvé pour la vue ${viewName}.`);
            appContent.innerHTML = `<div class="container"><h2>Erreur de Chargement</h2><p>Le contenu de la page "${viewName}" n'a pas pu être trouvé.</p></div>`;
            // Mettre à jour la navigation même en cas d'erreur de template
            navLinks.forEach(link => link.classList.remove('active'));
            return; // Sortir si le template n'est pas trouvé
        }
        
        // Mettre à jour la classe 'active' sur les liens de navigation
        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${viewName}`);
        });
        
        // Cibler le loader et le message de statut DANS la vue qui vient d'être injectée
        activeViewLoader = appContent.querySelector('#view-loader'); // Préférer querySelector sur appContent
        activeStatusMessage = appContent.querySelector('#statusMessage') || appContent.querySelector('#firebaseStatus');

        // Initialiser la logique JavaScript de la vue
        if (viewConfig.init) {
            try {
                viewConfig.init();
            } catch (e) {
                console.error(`Erreur lors de l'initialisation de la vue ${viewName}:`, e);
                setViewStatus(`Erreur au chargement de la page ${viewName}.`, 'error');
            }
        }
        
        // Stocker la fonction de nettoyage de la nouvelle vue si elle existe
        if (viewConfig.cleanup) {
            currentViewCleanup = viewConfig.cleanup;
        }

        // Remplacer les icônes Feather APRES que le nouveau contenu HTML est dans le DOM
        if (typeof feather !== 'undefined') {
            feather.replace();
            // console.log(`Feather icons replaced for view: ${viewName}`); // Pour débogage
        } else {
            console.warn("Feather icons library not loaded, cannot replace icons.");
        }

    } else {
        console.warn(`Configuration de vue non trouvée pour: ${viewName}`);
        appContent.innerHTML = '<div class="container"><h2>Page non trouvée</h2><p>La section demandée n\'existe pas.</p></div>';
        navLinks.forEach(link => link.classList.remove('active')); // S'assurer qu'aucun lien n'est actif
    }
}

// Gestion des événements de navigation
window.addEventListener('hashchange', () => navigateTo(location.hash));

// Chargement initial de la page
document.addEventListener('DOMContentLoaded', () => {
    // L'initialisation de Feather Icons se fera dans le premier appel à navigateTo
    navigateTo(location.hash || '#upload');
    console.log("Application SPA initialisée.");
});
