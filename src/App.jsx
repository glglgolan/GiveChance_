import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, query, serverTimestamp } from 'firebase/firestore';
import { Image as ImageIcon, Smile, Upload, Trash2, Send, Linkedin, RotateCcw, PenTool, CheckCircle, User, Shield, Wand, Loader } from 'lucide-react';
import { firebaseConfig, appId } from './firebaseConfig';

// --- Firebase Configuration ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Utility: Image Compression ---
const compressImage = (file) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const scaleSize = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
        };
    });
};

// --- Utility: Base64 Handling for LLM ---
const base64ToMimeType = (dataUrl) => {
    const parts = dataUrl.split(';base64,');
    return { mimeType: parts[0].split(':')[1], data: parts[1] };
};

// --- Components ---

// 1. Admin Panel
const AdminPanel = ({ user }) => {
    const [frames, setFrames] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'frames'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const framesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setFrames(framesData);
        });
        return () => unsubscribe();
    }, [user]);

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (frames.length >= 5) {
            // Use custom message box instead of alert
            console.log("ניתן להעלות עד 5 מסגרות בלבד. אנא מחק מסגרת קיימת.");
            return;
        }

        setLoading(true);
        try {
            const base64 = await compressImage(file);
            const newDocRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'frames'));
            await setDoc(newDocRef, {
                image: base64,
                createdAt: serverTimestamp(),
                name: file.name
            });
        } catch (error) {
            console.error("Error uploading frame:", error);
        }
        setLoading(false);
    };

    const handleDelete = async (id) => {
        // Use custom modal/confirm instead of native confirm
        if (window.confirm("האם למחוק את המסגרת הזו?")) {
            await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'frames', id));
        }
    };

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-6 text-slate-800 flex items-center gap-2">
                <Shield className="w-6 h-6 text-purple-600" />
                ניהול סטוק מסגרות
            </h2>

            <div className="mb-8 p-6 bg-white rounded-xl shadow-sm border border-slate-200">
                <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${frames.length >= 5 ? 'border-gray-300 bg-gray-50 opacity-50 cursor-not-allowed' : 'border-purple-300 bg-purple-50 hover:bg-purple-100'}`}>
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        {loading ? (
                            <span className="text-purple-600">מעלה...</span>
                        ) : (
                            <>
                                <Upload className="w-8 h-8 mb-2 text-purple-500" />
                                <p className="mb-1 text-sm text-slate-600"><span className="font-semibold">לחץ להעלאת מסגרת</span> (PNG שקוף מומלץ)</p>
                                <p className="text-xs text-slate-500">מקסימום 5 מסגרות ({frames.length}/5)</p>
                            </>
                        )}
                    </div>
                    <input type="file" className="hidden" onChange={handleUpload} accept="image/*" disabled={frames.length >= 5 || loading} />
                </label>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                {frames.map((frame) => (
                    <div key={frame.id} className="relative group bg-white p-2 rounded-lg shadow border border-slate-100">
                        <img src={frame.image} alt="Frame" className="w-full h-48 object-contain bg-checkerboard" />
                        <button
                            onClick={() => handleDelete(frame.id)}
                            className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
                {frames.length === 0 && (
                    <div className="col-span-full text-center py-10 text-slate-400">
                        אין מסגרות במאגר כרגע.
                    </div>
                )}
            </div>
        </div>
    );
};

// 2. Image Composer (User Action 1)
const ImageComposer = ({ frames }) => {
    const [userImage, setUserImage] = useState(null);
    const [selectedFrame, setSelectedFrame] = useState(null);
    const [addSmile, setAddSmile] = useState(false);
    const [composedImageURL, setComposedImageURL] = useState(null); // New state for generated image URL
    const [generatedCaption, setGeneratedCaption] = useState(''); // New state for generated caption/prompt
    const [isGeneratingCaption, setIsGeneratingCaption] = useState(false); // New state for loading indicator
    const canvasRef = useRef(null);

    // Set default frame (Point 3)
    useEffect(() => {
        if (frames.length > 0 && !selectedFrame) {
            setSelectedFrame(frames[0]);
        }
    }, [frames, selectedFrame]);

    const handleUserImageUpload = async (e) => {
        if (e.target.files && e.target.files[0]) {
            const base64 = await compressImage(e.target.files[0]);
            setUserImage(base64);
            setComposedImageURL(null); // Reset composed image on new upload
            setGeneratedCaption(''); // Reset caption
        }
    };

    // --- LLM Logic for Caption Generation ---
    const generateCaption = async (imageUrl) => {
        setIsGeneratingCaption(true);
        setGeneratedCaption('');
        const { mimeType, data: base64Data } = base64ToMimeType(imageUrl);

        const prompt = "Generate a short, compelling, and professional LinkedIn post hook (1-2 sentences in Hebrew) based on this profile picture with a frame. Focus on success, career jump, or getting a chance.";
        const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || "AIzaSyDJsfgwVDzr1uoazQCrJV3Dxowph2JPwCA"; // Canvas runtime provides this

        const payload = {
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Data
                            }
                        }
                    ]
                }
            ],
        };

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const maxRetries = 3;
        let delay = 1000;

        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();
                const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;

                if (text) {
                    setGeneratedCaption(text);
                    break; // Success
                }
            } catch (error) {
                console.warn(`Attempt ${i + 1} failed, retrying in ${delay}ms...`, error);
                if (i === maxRetries - 1) {
                    setGeneratedCaption("אירעה שגיאה בייצור הכותרת. אנא נסה שוב.");
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
            }
        }
        setIsGeneratingCaption(false);
    };
    // --- End LLM Logic ---


    const handleGenerateImage = () => {
        if (!userImage || !selectedFrame || !canvasRef.current) return;

        // 1. Reset previous image and caption
        setComposedImageURL(null);
        setGeneratedCaption('');

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        const uImg = new Image();
        const fImg = new Image();

        uImg.src = userImage;
        fImg.src = selectedFrame.image;

        // Wait for both to load
        Promise.all([
            new Promise(r => uImg.onload = r),
            new Promise(r => fImg.onload = r)
        ]).then(() => {
            // Set canvas size
            canvas.width = 1080;
            canvas.height = 1080;

            // Draw background (white)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 1080, 1080);

            // 2. Draw User Image and apply "Smile" effect filters
            // Calc ratio to cover the square
            const scale = Math.max(canvas.width / uImg.width, canvas.height / uImg.height);
            const x = (canvas.width / 2) - (uImg.width / 2) * scale;
            const y = (canvas.height / 2) - (uImg.height / 2) * scale;

            // Apply filters if smile effect is requested (Visual simulation for "add smile")
            if (addSmile) {
                ctx.filter = 'brightness(1.1) saturate(1.2) contrast(1.05)';
            }
            ctx.drawImage(uImg, x, y, uImg.width * scale, uImg.height * scale);
            ctx.filter = 'none'; // Reset filter

            // 3. Draw Frame on top of the user image (creating the unified image)
            ctx.drawImage(fImg, 0, 0, 1080, 1080);

            // 4. Add Sparkles as a visual indicator for the smile effect
            if (addSmile) {
                ctx.font = "100px Arial";
                ctx.fillText("✨", 50, 100);
                ctx.fillText("✨", 950, 150);
            }

            // 5. Present in the preview (set the URL)
            const finalImageUrl = canvas.toDataURL('image/png');
            setComposedImageURL(finalImageUrl);

            // 6. Generate caption using LLM with the final image
            generateCaption(finalImageUrl);
        });
    };

    const downloadImage = () => {
        if (composedImageURL) {
            const link = document.createElement('a');
            link.download = 'my-linkedin-post.png';
            link.href = composedImageURL; // Use the stored URL
            link.click();
        }
    };

    if (frames.length === 0) return <div className="text-center p-10">אין מסגרות זמינות. אנא בקש מהאדמין להעלות מסגרות.</div>;

    return (
        <div className="grid md:grid-cols-2 gap-8 p-4">
            <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><ImageIcon className="w-5 h-5 text-indigo-600" /> העלאת תמונה שלך</h3>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={handleUserImageUpload}
                        className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                    />
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-lg mb-4">בחירת מסגרת</h3>
                    <div className="grid grid-cols-3 gap-3">
                        {frames.map(f => (
                            <button
                                key={f.id}
                                onClick={() => { setSelectedFrame(f); setComposedImageURL(null); setGeneratedCaption(''); }} // Reset states on frame change
                                className={`border-2 rounded-lg overflow-hidden h-24 relative ${selectedFrame?.id === f.id ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-slate-200'}`}
                            >
                                <img src={f.image} className="w-full h-full object-cover" alt="Frame choice" />
                                {selectedFrame?.id === f.id && <CheckCircle className="absolute top-1 left-1 w-4 h-4 text-indigo-600 bg-white rounded-full" />}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Smile className={`w-6 h-6 ${addSmile ? 'text-yellow-500' : 'text-slate-400'}`} />
                        <span className="font-medium text-slate-700">הוסף "אפקט חיוך" (זוהר)</span>
                    </div>
                    <button
                        onClick={() => setAddSmile(!addSmile)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${addSmile ? 'bg-indigo-600' : 'bg-slate-200'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${addSmile ? 'translate-x-1' : 'translate-x-6'}`} />
                    </button>
                </div>

                {/* New Generate Button (Point 1) */}
                <button
                    onClick={handleGenerateImage}
                    disabled={!userImage || !selectedFrame || isGeneratingCaption}
                    className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                >
                    {isGeneratingCaption ? (
                        <>
                            <Loader className="w-5 h-5 animate-spin" />
                            יוצר תמונה וכותרת...
                        </>
                    ) : (
                        <>
                            <Wand className="w-5 h-5" />
                            צור תמונה מאוחדת
                        </>
                    )}
                </button>
            </div>

            <div className="flex flex-col items-center justify-center bg-slate-50 rounded-xl p-4 border border-slate-200 min-h-[400px]">
                {/* Display composed image if available */}
                {composedImageURL ? (
                    <>
                        <img src={composedImageURL} alt="תמונה מוכנה לפוסט" className="max-w-full h-auto shadow-lg rounded-lg mb-4" />

                        {/* Display generated caption/prompt */}
                        <div className="w-full mt-4 p-4 bg-indigo-50 border-t border-indigo-200 rounded-b-lg">
                            <h4 className="font-semibold text-indigo-800 mb-2">כותרת מוצעת לפוסט:</h4>
                            {isGeneratingCaption ? (
                                <p className="text-indigo-600 flex items-center gap-2">
                                    <Loader className="w-4 h-4 animate-spin" />
                                    מייצר כותרת...
                                </p>
                            ) : (
                                <p className="text-slate-700 leading-relaxed italic">
                                    {generatedCaption || "לא נוצרה כותרת. נסה שוב."}
                                </p>
                            )}
                        </div>

                        <button onClick={downloadImage} className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-full font-medium flex items-center gap-2">
                            <Upload className="w-4 h-4" /> הורד תמונה מוכנה
                        </button>
                    </>
                ) : (
                    <div className="text-center text-slate-400">
                        <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-30" />
                        {userImage && selectedFrame ? (
                            <p>לחץ על "צור תמונה מאוחדת" כדי לראות תצוגה מקדימה</p>
                        ) : (
                            <p>אנא בחר תמונה אישית ומסגרת כדי להתחיל</p>
                        )}
                    </div>
                )}
                {/* Hidden canvas for drawing context */}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
        </div>
    );
};

// 3. Post Generator (User Action 2)
const PostGenerator = () => {
    const [step, setStep] = useState(0);
    const [answers, setAnswers] = useState({});
    const [generatedPost, setGeneratedPost] = useState("");
    const [currentInput, setCurrentInput] = useState("");
    const [isGeneratingPost, setIsGeneratingPost] = useState(false); // New state for loading
    const [postError, setPostError] = useState(''); // New state for error
    const bottomRef = useRef(null);

    const questions = [
        { key: 'gender', type: 'choice', text: 'בוא נתחיל! האם לכתוב בלשון זכר או נקבה?', options: ['זכר', 'נקבה'] },
        { key: 'currentStatus', text: 'השלימי/השלם את המשפט: "השנה היא [שנה שבה זה קרה], בדיוק..." (למשל: סיימתי תואר, השתחררתי, עשיתי הסבה)' },
        { key: 'noExperience', text: 'ובמה היה לך אפס ניסיון? (למשל: שיווק, תוכנה, ניהול מוצר, מכירות)' },
        { key: 'dream', text: 'מה ניסית לעשות כדי להשיג את זה? (למשל: שלחתי קורות חיים לכל חברה אפשרית, ניסיתי להתקבל ל...)' },
        { key: 'event', text: 'מי האיש או האירוע ששינה הכל? (למשל: המגייסת התקשרה, פגשתי חבר מהצבא, המנכ"ל זימן אותי)' },
        { key: 'location', text: 'איפה נפגשתם/דיברתם? (למשל: בזום, בבית קפה, במשרדים בתל אביב)' },
        { key: 'insight', text: 'מה הוא אמר שהוא ראה בך? (למשל: את נראית לי כמו פייטרית, יש לי תחושה שאתה רעב להצלחה)' },
        { key: 'role', text: 'לאיזה תפקיד נכנסת בסוף ואיפה? (למשל: לתפקיד של ג׳וניור במיקרוסופט)' },
        { key: 'lesson', text: 'מה למדת בשנה הזו? (למשל: את כל מה שאני יודע על דאטה, איך לעבוד בצוות)' }
    ];

    const handleNext = (val) => {
        const value = val || currentInput;
        if (!value) return;

        setAnswers(prev => ({ ...prev, [questions[step].key]: value }));
        setCurrentInput("");

        if (step < questions.length - 1) {
            setStep(prev => prev + 1);
        } else {
            // Final step: generate post using LLM
            generatePost({ ...answers, [questions[step].key]: value }, false);
            setStep(prev => prev + 1);
        }
    };

    useEffect(() => {
        if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [step, generatedPost]);

    // --- LLM Logic for Post Generation ---
    const generatePost = async (data, variation = false) => {
        setIsGeneratingPost(true);
        setGeneratedPost("");
        setPostError('');

        // Helper to format answers for the LLM
        const answersText = `
    ג׳נדר (לכתיבה נכונה): ${data.gender}
    סטטוס התחלתי: ${data.currentStatus}
    אפס ניסיון בתחום: ${data.noExperience}
    מה ניסה/ניסתה לעשות: ${data.dream}
    האדם/אירוע ששינה הכל: ${data.event}
    מיקום הפגישה/אירוע: ${data.location}
    מה ראו בו/בה: ${data.insight}
    התפקיד שקיבל/ה: ${data.role}
    מה למד/ה: ${data.lesson}
    `;

        // System Instruction to enforce structure and tone
        const systemInstruction = `
    אתה מחולל פוסטים רשמי, יצירתי וקומי קלות עבור לינקדאין.
    המטרה היא ליצור פוסט סיפורי ומרגש (עם טון קומי קל) על קבלת צ'אנס בקריירה, המבוסס על הנתונים הבאים.

    הפוסט חייב להיות כתוב בשפה עברית יצירתית, בלשון זכר או נקבה בהתאם לג׳נדר שצויין, וחייב לעמוד בפורמט המבני המדויק הבא:
    
    1.  הוק: משפט סיכום אחד משכנע: 'הוק- תקציר סיפור בשורה אחת איך הפכתי מ[אפס ניסיון] ל[תפקיד שקיבל/ה]'.
    2.  פתיחה (שנה + התחלה): משפט המתחיל 'השנה היא...' וכולל את הסטטוס ההתחלתי ואת התחום ללא ניסיון.
    3.  רקע (הרצון/החלום): תיאור קצר של המאמצים (החלום) וכיצד ניסה/ניסתה להשיג את התפקיד.
    4.  נקודת מפנה (השיחה/אירוע): תיאור פגישה/אירוע ששינה את הכל, כולל מיקום האירוע.
    5.  ההבנה (מה הוא ראה בי): דגש על מה שהאדם שנתן את הצ'אנס ראה בך (האינסייט).
    6.  הקפיצה והשיעור: משפט על הקפיצה לתפקיד, ואחריו משפט על מה שלמדת בשנה זו.
    7.  הפאנץ' ליין חובה: 'הצלחתי, אבל בתכלס - מישהו פשוט נתן לי צ’אנס.'
    
    **כללי עיצוב חובה:**
    * הסר לחלוטין את כותרות החלקים (1. הוק, 2. פתיחה, וכו') מהטקסט הסופי.
    * השתמש במעברי שורה כפולים (שורה ריקה) בין החלקים (כדי ליצור פסקאות קצרות).
    * **חשוב:** צור ניסוח ייחודי לכל חלק בפוסט, ללא שימוש במשפטים קבועים מראש (Constant Wording).
    * **שימוש חופשי בסימני פיסוק:** השתמש בסימני פיסוק (נקודות, פסיקים וכו') בצורה נכונה וטבעית ליצירת סיפור קוהרנטי.
    ${variation ? "הערה חשובה: צור פוסט זה שוב, אך עם סגנון כתיבה שונה וסיפורי יותר, ושמור על אותם פרטי מפתח." : ""}
    `;

        const userQuery = `הנתונים ליצירת הפוסט: ${answersText}`;
        const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || "AIzaSyDJsfgwVDzr1uoazQCrJV3Dxowph2JPwCA";

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
        };

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const maxRetries = 3;
        let delay = 1000;

        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();
                const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;

                if (text) {
                    // Clean up any residual LLM formatting
                    const cleanedText = text.split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0)
                        .join('\n\n')
                        .replace(/^\d+\.\s*/gm, ''); // Remove numbering like '1. ', '2. '

                    setGeneratedPost(cleanedText);
                    break; // Success
                }
            } catch (error) {
                console.error(`Attempt ${i + 1} failed, retrying in ${delay}ms...`, error);
                if (i === maxRetries - 1) {
                    setPostError("שגיאה בייצור הפוסט. אנא נסה שוב.");
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
            }
        }
        setIsGeneratingPost(false);
    };
    // --- End LLM Logic ---

    const shareToLinkedIn = () => {
        const url = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(generatedPost)}`;
        window.open(url, '_blank');
    };

    if (generatedPost || isGeneratingPost) {
        return (
            <div className="max-w-2xl mx-auto bg-white p-6 rounded-xl shadow-lg border border-slate-200 animate-fade-in">
                <h3 className="text-xl font-bold mb-4 text-slate-800">הפוסט שלך מוכן! 🎉</h3>

                {isGeneratingPost ? (
                    <div className="h-96 flex items-center justify-center bg-slate-50 border border-slate-200 rounded-lg">
                        <Loader className="w-8 h-8 animate-spin text-indigo-600" />
                        <span className="text-indigo-600 mr-3">מייצר סיפור חדש...</span>
                    </div>
                ) : (
                    <textarea
                        className="w-full h-96 p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-sans leading-relaxed focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                        value={postError || generatedPost}
                        onChange={(e) => setGeneratedPost(e.target.value)}
                    />
                )}

                {postError && <p className="text-red-500 mt-2">{postError}</p>}

                <div className="flex gap-4 mt-6">
                    <button
                        onClick={() => generatePost(answers, true)} // Regenerate with variation
                        disabled={isGeneratingPost}
                        className="flex-1 py-3 px-4 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        <RotateCcw className="w-5 h-5" />
                        ג'נרט פוסט חדש (ניסוח שונה)
                    </button>
                    <button
                        onClick={shareToLinkedIn}
                        disabled={isGeneratingPost || postError}
                        className="flex-1 py-3 px-4 bg-[#0077b5] text-white rounded-lg font-medium hover:bg-[#006396] flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                    >
                        <Linkedin className="w-5 h-5" />
                        אהבתי! ללינקדאין
                    </button>
                </div>
                <button onClick={() => { setStep(0); setGeneratedPost(""); setAnswers({}); setPostError(''); }} className="mt-4 text-sm text-slate-400 hover:text-slate-600 underline w-full text-center">
                    התחל מההתחלה
                </button>
            </div>
        );
    }

    const currentQ = questions[step];

    return (
        <div className="max-w-2xl mx-auto flex flex-col h-[600px] bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-indigo-600 p-4 text-white font-bold flex items-center gap-2">
                <PenTool className="w-5 h-5" />
                בנה את הסיפור שלך
            </div>

            <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50">
                {/* NEW INSTRUCTIONAL MESSAGE (Point 2) */}
                {step === 0 && (
                    <div className="self-start bg-indigo-100 text-indigo-900 px-5 py-3 rounded-xl max-w-[90%] text-base font-medium">
                        <p className='font-bold mb-1'>👋 ברוכים הבאים למחולל הפוסטים!</p>
                        <p>כדי ליצור סיפור מעניין, אנא השתדל/י לענות על השאלות בפירוט ועם פרטים קטנים ומשעשעים. זה יעזור ליצור פוסט בלתי נשכח! ✨</p>
                    </div>
                )}

                {/* History */}
                {Object.keys(answers).map((key, idx) => (
                    <div key={key} className="flex flex-col animate-fade-in-up">
                        <div className="self-start bg-slate-200 text-slate-700 px-4 py-2 rounded-t-xl rounded-br-xl max-w-[80%] mb-1 text-sm">
                            {questions[idx].text}
                        </div>
                        <div className="self-end bg-indigo-100 text-indigo-900 px-4 py-2 rounded-t-xl rounded-bl-xl max-w-[80%] font-medium">
                            {answers[key]}
                        </div>
                    </div>
                ))}

                {/* Current Question */}
                <div className="self-start bg-white border border-slate-200 shadow-sm text-slate-800 px-5 py-3 rounded-t-xl rounded-br-xl max-w-[90%] text-lg font-medium">
                    {currentQ.text}
                </div>
                <div ref={bottomRef} />
            </div>

            <div className="p-4 bg-white border-t border-slate-100">
                {currentQ.type === 'choice' ? (
                    <div className="flex gap-3">
                        {currentQ.options.map(opt => (
                            <button
                                key={opt}
                                onClick={() => handleNext(opt)}
                                className="flex-1 bg-indigo-50 border border-indigo-200 text-indigo-700 py-3 rounded-lg hover:bg-indigo-100 transition-colors font-medium"
                            >
                                {opt}
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={currentInput}
                            onChange={(e) => setCurrentInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                            placeholder="הקלד את התשובה שלך..."
                            className="flex-1 border border-slate-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                        />
                        <button
                            onClick={() => handleNext()}
                            disabled={!currentInput.trim()}
                            className="bg-indigo-600 text-white p-3 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Send className="w-5 h-5 rtl:rotate-180" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// 4. User Panel Layout
const UserPanel = ({ user }) => {
    const [activeTab, setActiveTab] = useState('image');
    const [frames, setFrames] = useState([]);

    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'frames'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setFrames(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsubscribe();
    }, [user]);

    return (
        <div className="max-w-5xl mx-auto p-4">
            <div className="flex justify-center mb-8">
                <div className="bg-white p-1 rounded-full shadow-sm border border-slate-200 flex">
                    <button
                        onClick={() => setActiveTab('image')}
                        className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${activeTab === 'image' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        1. סידור תמונה
                    </button>
                    <button
                        onClick={() => setActiveTab('story')}
                        className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${activeTab === 'story' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        2. יצירת פוסט
                    </button>
                </div>
            </div>

            <div className="animate-fade-in">
                {activeTab === 'image' ? (
                    <ImageComposer frames={frames} />
                ) : (
                    <PostGenerator />
                )}
            </div>
        </div>
    );
};

// --- Main App ---
export default function App() {
    const [user, setUser] = useState(null);
    const [role, setRole] = useState(null); // 'admin' or 'user' or 'pending_admin'
    const [authInitialized, setAuthInitialized] = useState(false);
    const [adminPasswordInput, setAdminPasswordInput] = useState('');
    const [adminError, setAdminError] = useState('');

    // Fixed admin password for security check
    const ADMIN_PASSWORD = 'Place26';

    useEffect(() => {
        const initAuth = async () => {
            // NOTE: Removed custom token check for simplicity/safety in this env,
            // but you can re-enable if you have a mechanism to inject __initial_auth_token
            await signInAnonymously(auth);
            setAuthInitialized(true);
        };
        initAuth();
        const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsubscribe();
    }, []);

    const handleRoleSelection = (selectedRole) => {
        if (selectedRole === 'admin') {
            setRole('pending_admin'); // Enter password prompt state
        } else {
            setRole(selectedRole);
        }
    };

    const handleAdminLogin = () => {
        setAdminError('');
        if (adminPasswordInput === ADMIN_PASSWORD) {
            setRole('admin');
            setAdminPasswordInput(''); // Clear password
        } else {
            setAdminError('סיסמא שגויה. נסה שוב.');
        }
    };


    if (!authInitialized || !user) return <div className="h-screen flex items-center justify-center text-indigo-600">טוען מערכת...</div>;

    // Landing / Role Selection / Admin Password Prompt (Point 2)
    if (!role || role === 'pending_admin') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-100 flex items-center justify-center p-4" dir="rtl">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center space-y-8">
                    {role === 'pending_admin' ? (
                        // Admin Password Prompt UI
                        <div className="space-y-4">
                            <h1 className="text-2xl font-bold text-slate-800">כניסת אדמין</h1>
                            <p className="text-slate-500">אנא הזן את סיסמת האדמין כדי להמשיך.</p>

                            <input
                                type="password" // ensures masking and security
                                value={adminPasswordInput}
                                onChange={(e) => setAdminPasswordInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                                placeholder="סיסמת אדמין"
                                className="w-full border border-slate-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                            />

                            {adminError && <p className="text-red-500 text-sm">{adminError}</p>}

                            <button
                                onClick={handleAdminLogin}
                                className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors"
                            >
                                כניסה
                            </button>
                            <button onClick={() => { setRole(null); setAdminError(''); }} className="w-full mt-2 text-sm text-slate-500 hover:text-slate-700">
                                חזור לבחירת תפקיד
                            </button>
                        </div>
                    ) : (
                        // Role Selection UI
                        <>
                            <div>
                                <h1 className="text-3xl font-bold text-slate-800 mb-2">ברוכים הבאים</h1>
                                <p className="text-slate-500">בחר את אופן הכניסה למערכת</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => handleRoleSelection('user')}
                                    className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition-all group"
                                >
                                    <User className="w-10 h-10 text-slate-400 group-hover:text-indigo-600 mb-3" />
                                    <span className="font-bold text-slate-700 group-hover:text-indigo-700">משתמש רגיל</span>
                                </button>
                                <button
                                    onClick={() => handleRoleSelection('admin')}
                                    className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-all group"
                                >
                                    <Shield className="w-10 h-10 text-slate-400 group-hover:text-purple-600 mb-3" />
                                    <span className="font-bold text-slate-700 group-hover:text-purple-700">אדמין</span>
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 font-sans" dir="rtl">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">In</div>
                        <h1 className="font-bold text-xl text-slate-800 hidden sm:block">מחולל לינקדאין</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-sm px-3 py-1 bg-slate-100 rounded-full text-slate-600">
                            מחובר כ: <span className="font-bold">{role === 'admin' ? 'אדמין' : 'משתמש'}</span>
                        </span>
                        <button onClick={() => setRole(null)} className="text-sm text-red-500 hover:text-red-700 font-medium">
                            יציאה
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="py-8">
                {role === 'admin' ? <AdminPanel user={user} /> : <UserPanel user={user} />}
            </main>

            {/* Global CSS for Checkboard pattern and animations */}
            <style>{`
        .bg-checkerboard {
            background-image: linear-gradient(45deg, #f0f0f0 25%, transparent 25%), 
              linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), 
              linear-gradient(45deg, transparent 75%, #f0f0f0 75%), 
              linear-gradient(-45deg, transparent 75%, #f0f0f0 75%);
            background-size: 20px 20px;
            background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .animate-fade-in {
            animation: fadeIn 0.5s ease-out;
        }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
            animation: fadeInUp 0.3s ease-out;
        }
      `}</style>
        </div>
    );
}
