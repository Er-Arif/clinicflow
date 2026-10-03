DEFAULT_MESSAGE_TEMPLATES = [
    ("APPOINTMENT_CONFIRMATION", "EN", "Hello {patient_name},\n\nYour appointment with {doctor_name} at {clinic_name} is booked.\nDate: {appointment_date}\nTime: {appointment_time}\n\nPlease contact the clinic if you are unable to attend."),
    ("APPOINTMENT_CONFIRMATION", "HI", "नमस्ते {patient_name},\n\n{clinic_name} में {doctor_name} के साथ आपका अपॉइंटमेंट बुक हो गया है।\nदिनांक: {appointment_date}\nसमय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया क्लिनिक से संपर्क करें।"),
    ("APPOINTMENT_REMINDER", "EN", "Hello {patient_name},\n\nThis is a reminder for your appointment with {doctor_name}.\nDate: {appointment_date}\nTime: {appointment_time}\n\nPlease contact {clinic_name} if you are unable to attend."),
    ("APPOINTMENT_REMINDER", "HI", "नमस्ते {patient_name},\n\nयह {doctor_name} के साथ आपके अपॉइंटमेंट की याद दिलाने वाला संदेश है।\nदिनांक: {appointment_date}\nसमय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया {clinic_name} से संपर्क करें।"),
    ("APPOINTMENT_CANCELLED", "EN", "Hello {patient_name},\n\nYour appointment with {doctor_name} on {appointment_date} at {appointment_time} has been cancelled.\nPlease contact {clinic_name} if you need another appointment."),
    ("APPOINTMENT_CANCELLED", "HI", "नमस्ते {patient_name},\n\n{doctor_name} के साथ {appointment_date} को {appointment_time} वाला आपका अपॉइंटमेंट रद्द कर दिया गया है।\nनया अपॉइंटमेंट चाहिए तो कृपया {clinic_name} से संपर्क करें।"),
    ("APPOINTMENT_RESCHEDULED", "EN", "Hello {patient_name},\n\nYour appointment with {doctor_name} has been rescheduled.\nNew date: {appointment_date}\nNew time: {appointment_time}\n\nPlease contact {clinic_name} if you are unable to attend."),
    ("APPOINTMENT_RESCHEDULED", "HI", "नमस्ते {patient_name},\n\n{doctor_name} के साथ आपका अपॉइंटमेंट बदल दिया गया है।\nनई तारीख: {appointment_date}\nनया समय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया {clinic_name} से संपर्क करें।"),
    ("FOLLOWUP_REMINDER", "EN", "Hello {patient_name},\n\nThis is a reminder that your follow-up with {doctor_name} is due around {followup_due_date}.\nPlease contact {clinic_name} to book an appointment."),
    ("FOLLOWUP_REMINDER", "HI", "नमस्ते {patient_name},\n\n{doctor_name} के साथ आपका फॉलो-अप लगभग {followup_due_date} को निर्धारित है।\nअपॉइंटमेंट बुक करने के लिए कृपया {clinic_name} से संपर्क करें।"),
]
