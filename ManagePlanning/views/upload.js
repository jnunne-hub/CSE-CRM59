import { db, showViewLoader, setViewStatus } from '../script.js'; // Importation depuis le script principal

// --- Configuration commune pour UPLOAD VIEW ---
const WORK_ACTIVITY_PREFIXES = ['VAL_', 'REU_', 'FOR_', 'PRD_', 'ZZZ_'];
const EXPLICIT_NON_WORK_ACTIVITIES = ['PAU_REPAS'];
const NON_WORK_ACTIVITY_PREFIXES = ['ABS_', 'CGE_', 'MAL_'];
const FULL_DAY_WORK_HOURS_MAP = { "FOR_FORMATION SYNDICALE": 7, "PRD_TELETRAVAIL": 7 };
const MONTH_MAP_FR = {
    'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
    'juillet': 6, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11
};
let currentWeeklyHoursData = {};
let personName = "Inconnu";

export function initUploadView() {
    console.log("Initialisation de la vue Upload");
    const calculateButton = document.getElementById('calculateButton');
    const exportCsvButton = document.getElementById('exportCsvButton');
    const saveFirebaseButton = document.getElementById('saveFirebaseButton');

    if (calculateButton) calculateButton.addEventListener('click', processPDF_UploadView);
    if (exportCsvButton) exportCsvButton.addEventListener('click', exportToCSV_UploadView);
    if (saveFirebaseButton) saveFirebaseButton.addEventListener('click', saveDataToFirebase_UploadView);

    currentWeeklyHoursData = {};
    personName = "Inconnu";
    const outputElement = document.getElementById('output');
    if (outputElement) outputElement.textContent = '';
    if (exportCsvButton) exportCsvButton.style.display = 'none';
    if (saveFirebaseButton) saveFirebaseButton.style.display = 'none';
    setViewStatus(''); // Cible #firebaseStatus via la logique de script.js
}

async function processPDF_UploadView() {
    const fileInput = document.getElementById('pdfFile');
    const outputElement = document.getElementById('output');
    const exportButton = document.getElementById('exportCsvButton');
    const saveFirebaseBtn = document.getElementById('saveFirebaseButton');

    if (!outputElement || !exportButton || !saveFirebaseBtn || !fileInput) {
        console.error("Un ou plusieurs éléments DOM sont manquants dans la vue Upload.");
        return;
    }
    
    outputElement.textContent = '';
    setViewStatus(''); // Cible #firebaseStatus
    exportButton.style.display = 'none';
    saveFirebaseBtn.style.display = 'none';
    currentWeeklyHoursData = {};
    personName = "Inconnu";

    if (!fileInput.files.length) {
        outputElement.textContent = 'Veuillez sélectionner un fichier PDF.';
        return;
    }
    if (typeof pdfjsLib === 'undefined') {
        outputElement.textContent = "Erreur: La librairie PDF.js n'a pas pu être chargée.";
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();
    showViewLoader(true);

    reader.onload = async function(event) {
        try {
            const typedArray = new Uint8Array(event.target.result);
            const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
            let fullText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                fullText += textContent.items.map(item => item.str.trim()).filter(s => s.length > 0).join('\n') + '\n\n';
            }

            const linesOfText = fullText.split('\n');
            const planningLineRegex = /Planning de travail pour\s+(.+)/i;
            let nameLineFound = false;
            for (const line of linesOfText) {
                if (nameLineFound) break;
                const match = line.match(planningLineRegex);
                if (match && match[1]) {
                    let extractedName = match[1].trim();
                    const peoplewareIndex = extractedName.toLowerCase().indexOf("peopleware");
                    if (peoplewareIndex !== -1) extractedName = extractedName.substring(0, peoplewareIndex).trim();
                    const dayOfWeekInNameRegex = /\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{2}\.\s+\w+/i;
                    const dayMatchInName = extractedName.match(dayOfWeekInNameRegex);
                    if (dayMatchInName) extractedName = extractedName.substring(0, dayMatchInName.index).trim();
                    if (extractedName) { personName = extractedName; nameLineFound = true; }
                }
            }
            const weeklyHours = parseScheduleAndCalculateHours_UploadView(fullText);
            currentWeeklyHoursData = weeklyHours;
            displayResults_UploadView(weeklyHours);
        } catch (error) {
            console.error("Erreur lors du traitement du PDF (UploadView):", error);
            if(outputElement) outputElement.textContent = `Erreur: ${error.message}.`;
        } finally {
            showViewLoader(false);
        }
    };
    reader.onerror = function() {
        if(outputElement) outputElement.textContent = 'Erreur lors de la lecture du fichier.';
        showViewLoader(false);
    };
    reader.readAsArrayBuffer(file);
}

function parseDateString_UploadView(dateStrPart) {
    const cleanedDateStr = dateStrPart.replace(/\.(?=\s*\d{4})/, '').replace('.', '');
    const parts = cleanedDateStr.trim().split(/\s+/);
    if (parts.length < 3) return null;
    const day = parseInt(parts[0]), monthName = parts[1].toLowerCase(), year = parseInt(parts[2]);
    if (isNaN(day) || isNaN(year) || !(monthName in MONTH_MAP_FR)) return null;
    return new Date(year, MONTH_MAP_FR[monthName], day);
}

function getWeekNumber_UploadView(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function calculateDuration_UploadView(startTimeStr, endTimeStr) {
    const [startH, startM] = startTimeStr.split(':').map(Number);
    const [endH, endM] = endTimeStr.split(':').map(Number);
    let diffMs = (new Date(0, 0, 0, endH, endM, 0)) - (new Date(0, 0, 0, startH, startM, 0));
    if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;
    return diffMs / (1000 * 60 * 60);
}

function isWorkActivity_UploadView(activityDescription) {
    const norm = activityDescription.toUpperCase().trim();
    if (EXPLICIT_NON_WORK_ACTIVITIES.some(e => norm.includes(e))) return false;
    if (NON_WORK_ACTIVITY_PREFIXES.some(p => norm.startsWith(p))) return false;
    return WORK_ACTIVITY_PREFIXES.some(p => norm.startsWith(p));
}

function parseScheduleAndCalculateHours_UploadView(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const weeklyHours = {}; let currentDate = null, currentDayMarkedAsFullDayEvent = false, potentielJourSemaine = null;
    const dayOfWeekRegex = /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)$/i;
    const shortDateRegex = /^(\d{1,2}(?:er)?\s*\.\s*\w+\.?\s+\d{4})$/i;
    const timeSlotRegex = /(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s+(.+)/;
    const fullDayRegex = /^Journée entière\s+(.+)/i;
    const ignorePatterns = [/Planning de travail pour/i, /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}(?:er)?\s*\.\s*\w+\.?\s+\d{4}\s+-\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}(?:er)?\s*\.\s*\w+\.?\s+\d{4}/i, /^Date\s+Planning de travail$/i, /Page \d+ sur \d+/i, /© \d{4} peopleware/i, /^peopleware$/i, /^Date$/i, /^Planning de travail$/i, /^comments_text$/i];

    for (let i = 0; i < lines.length; i++) {
        let trimmedLine = lines[i];
        if (trimmedLine === personName && personName !== "Inconnu") continue;
        if (ignorePatterns.some(p => p.test(trimmedLine))) continue;
        const dayMatch = trimmedLine.match(dayOfWeekRegex); // Renommé pour clarté
        if (dayMatch) { potentielJourSemaine = dayMatch[1]; currentDate = null; currentDayMarkedAsFullDayEvent = false; continue; }


        if (potentielJourSemaine) {
            const shortDateMatch = trimmedLine.match(shortDateRegex);
            if (shortDateMatch) {
                let dateStrPart = shortDateMatch[1].replace('1er', '01');
                const newDate = parseDateString_UploadView(dateStrPart);
                if (newDate) {
                    currentDate = newDate; currentDayMarkedAsFullDayEvent = false; potentielJourSemaine = null;
                    if (i + 1 < lines.length) {
                        const nextLineFullDayMatch = lines[i + 1].match(fullDayRegex);
                        if (nextLineFullDayMatch) {
                            const fullDayActivityDesc = nextLineFullDayMatch[1].trim().toUpperCase();
                            const activityCode = fullDayActivityDesc.split(' ')[0];
                            if (FULL_DAY_WORK_HOURS_MAP[activityCode]) {
                                const duration = FULL_DAY_WORK_HOURS_MAP[activityCode];
                                if (duration > 0) weeklyHours[getWeekNumber_UploadView(currentDate)] = (weeklyHours[getWeekNumber_UploadView(currentDate)] || 0) + duration;
                            }
                            currentDayMarkedAsFullDayEvent = true; i++; continue;
                        }
                    } continue;
                } else potentielJourSemaine = null;
            } else if (trimmedLine.length > 0 && !trimmedLine.match(fullDayRegex)) potentielJourSemaine = null;
        }
        if (currentDate && currentDayMarkedAsFullDayEvent) continue;
        if (currentDate) {
            const fullDayMatchOnActivityLine = trimmedLine.match(fullDayRegex);
            if (fullDayMatchOnActivityLine) {
                // Logique similaire à nextLineFullDayMatch pour 'Journée entière' sur la ligne d'activité
                const fullDayActivityDesc = fullDayMatchOnActivityLine[1].trim().toUpperCase();
                const activityCode = fullDayActivityDesc.split(' ')[0];
                if (FULL_DAY_WORK_HOURS_MAP[activityCode]) {
                    const duration = FULL_DAY_WORK_HOURS_MAP[activityCode];
                    if (duration > 0) weeklyHours[getWeekNumber_UploadView(currentDate)] = (weeklyHours[getWeekNumber_UploadView(currentDate)] || 0) + duration;
                }
                currentDayMarkedAsFullDayEvent = true; 
                continue;
            }
            const timeSlotMatch = trimmedLine.match(timeSlotRegex);
            if (timeSlotMatch && isWorkActivity_UploadView(timeSlotMatch[3].trim())) {
                const duration = calculateDuration_UploadView(timeSlotMatch[1], timeSlotMatch[2]);
                if (duration > 0) weeklyHours[getWeekNumber_UploadView(currentDate)] = (weeklyHours[getWeekNumber_UploadView(currentDate)] || 0) + duration;
            }
        }
    } return weeklyHours;
}

function displayResults_UploadView(weeklyHours) {
    const outputElement = document.getElementById('output');
    const exportButton = document.getElementById('exportCsvButton');
    const saveFirebaseBtn = document.getElementById('saveFirebaseButton');
    if (!outputElement || !exportButton || !saveFirebaseBtn) return;

    let resultText = `Heures de travail pour ${personName} par semaine :\n\n`;
    const sortedWeeks = Object.keys(weeklyHours).sort();

    if (sortedWeeks.length === 0) {
        resultText += "Aucune heure de travail calculée. Vérifiez la config et le PDF.\n";
        exportButton.style.display = 'none'; saveFirebaseBtn.style.display = 'none';
    } else {
        sortedWeeks.forEach(week => resultText += `Semaine ${week}: ${weeklyHours[week].toFixed(2)} heures\n`);
        exportButton.style.display = 'inline-block';
        if (db) saveFirebaseBtn.style.display = 'inline-block';
    }
    outputElement.textContent = resultText;
}

function exportToCSV_UploadView() {
    if (Object.keys(currentWeeklyHoursData).length === 0) { alert("Aucune donnée."); return; }
    let csv = "Personne,Semaine,HeuresTravaillees\r\n";
    Object.keys(currentWeeklyHoursData).sort().forEach(week => {
        csv += `"${personName.replace(/"/g, '""')}","${week}","${currentWeeklyHoursData[week].toFixed(2)}"\r\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `heures_${personName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); // Requis pour Firefox
    link.click();
    document.body.removeChild(link); // Nettoyage
    URL.revokeObjectURL(link.href);
}

async function saveDataToFirebase_UploadView() {
    const firebaseStatusEl = document.getElementById('firebaseStatus');
    if (!firebaseStatusEl) return;

    if (!db) { firebaseStatusEl.textContent = "Erreur: Firebase non initialisé."; return; }
    if (Object.keys(currentWeeklyHoursData).length === 0) { firebaseStatusEl.textContent = "Aucune donnée."; return; }

    showViewLoader(true);
    firebaseStatusEl.textContent = "Enregistrement...";
    const saveBtn = document.getElementById('saveFirebaseButton');
    if (saveBtn) saveBtn.disabled = true;
    
    const batch = db.batch();
    for (const weekKey in currentWeeklyHoursData) {
        const docRef = db.collection("heuresTravail").doc();
        batch.set(docRef, {
            personne: personName, semaine: weekKey,
            heures: parseFloat(currentWeeklyHoursData[weekKey].toFixed(2)),
            dateEnregistrement: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
    try {
        await batch.commit();
        firebaseStatusEl.textContent = `Données pour ${personName} enregistrées !`;
    } catch (e) {
        console.error("Erreur Firebase (UploadView):", e); firebaseStatusEl.textContent = `Erreur: ${e.message}`;
    } finally {
        showViewLoader(false); if (saveBtn) saveBtn.disabled = false;
    }
}