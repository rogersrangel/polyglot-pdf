
const DB_NAME = 'PolyglotCoreDB';
const DB_VERSION = 3; 

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pages')) {
        const pageStore = db.createObjectStore('pages', { keyPath: 'id' });
        pageStore.createIndex('projectId', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'projectId' });
      }
    };
  });
};

// Configurações
export const setSetting = async (key: string, value: any) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['settings'], 'readwrite');
    transaction.objectStore('settings').put({ key, value });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getSetting = async (key: string): Promise<any> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['settings'], 'readonly');
    const request = transaction.objectStore('settings').get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
};

// Arquivos Binários
export const saveFile = async (projectId: string, data: ArrayBuffer) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['files'], 'readwrite');
    transaction.objectStore('files').put({ projectId, data });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getFile = async (projectId: string): Promise<ArrayBuffer | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['files'], 'readonly');
    const request = transaction.objectStore('files').get(projectId);
    request.onsuccess = () => resolve(request.result?.data || null);
    request.onerror = () => reject(request.error);
  });
};

// Projetos
export const saveProject = async (project: any) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['projects'], 'readwrite');
    transaction.objectStore('projects').put(project);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
};

export const deleteProject = async (projectId: string) => {
  const db = await initDB();
  const tx = db.transaction(['projects', 'pages', 'files'], 'readwrite');
  tx.objectStore('projects').delete(projectId);
  tx.objectStore('files').delete(projectId);
  const pageStore = tx.objectStore('pages');
  const index = pageStore.index('projectId');
  const request = index.getAllKeys(projectId);
  request.onsuccess = () => {
    request.result.forEach(key => pageStore.delete(key));
  };
  return new Promise(resolve => tx.oncomplete = () => resolve(true));
};

export const savePage = async (projectId: string, pageData: any) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pages'], 'readwrite');
    transaction.objectStore('pages').put({
      id: `${projectId}_${pageData.pageNumber}`,
      projectId,
      ...pageData
    });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getProjectPages = async (projectId: string): Promise<any[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pages'], 'readonly');
    const index = transaction.objectStore('pages').index('projectId');
    const request = index.getAll(projectId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const deletePagesFromProject = async (projectId: string, pageNumbers: number[]) => {
  const db = await initDB();
  const transaction = db.transaction(['pages'], 'readwrite');
  const store = transaction.objectStore('pages');
  pageNumbers.forEach(num => {
    store.delete(`${projectId}_${num}`);
  });
  return new Promise(resolve => transaction.oncomplete = () => resolve(true));
};

export const getAllProjects = async (): Promise<any[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['projects'], 'readonly');
    const request = transaction.objectStore('projects').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};
