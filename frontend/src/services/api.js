import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const uploadData = async (file) => {
  const formData = new FormData()
  formData.append('file', file)

  const response = await axios.post(`${API_URL}/api/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })

  return response.data
}

export const geocodeAddresses = async (addresses) => {
  const response = await axios.post(`${API_URL}/api/geocode`, {
    addresses
  })

  return response.data
}

export const uploadTemplate = async (file) => {
  const formData = new FormData()
  formData.append('file', file)

  const response = await axios.post(`${API_URL}/api/upload-template`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })

  return response.data
}

export const generatePPTX = async (config) => {
  console.log('API.JS - About to send to backend:', config)
  console.log('API.JS - markerStyles being sent:', config.markerStyles)
  console.log('API.JS - JSON stringified:', JSON.stringify(config, null, 2))

  const response = await axios.post(`${API_URL}/api/generate-pptx`, config, {
    responseType: 'blob',
  })

  // Download file
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', 'map_presentation.pptx')
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}
