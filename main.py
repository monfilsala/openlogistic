import os

# --- Configuración ---
target_directory = 'entrega2'
output_file = 'route.txt'

# Lista de nombres de carpetas que queremos ignorar SIEMPRE.
# Puedes añadir más, como '.git', 'dist', 'build', etc.
folders_to_ignore = {'node_modules', '.git', '__pycache__'}

# --- INICIO DEL SCRIPT ---
if not os.path.isdir(target_directory):
    print(f"Error: El directorio '{target_directory}' no fue encontrado.")
else:
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            
            # Usamos os.walk para recorrer el directorio
            for dirpath, dirnames, filenames in os.walk(target_directory):
                
                # --- LÓGICA DE EXCLUSIÓN ---
                # Modificamos la lista 'dirnames' para que os.walk() no entre en las carpetas ignoradas.
                # Hacemos una copia [:] para poder modificar la lista original mientras la recorremos.
                for folder in dirnames[:]:
                    if folder in folders_to_ignore:
                        print(f"Omitiendo la carpeta: {os.path.join(dirpath, folder)}")
                        dirnames.remove(folder)

                # Escribimos las rutas de los archivos del directorio actual
                for filename in filenames:
                    full_path = os.path.join(dirpath, filename)
                    f.write(full_path + '\n')
        
        print(f"\n¡Listo! Se ha creado el archivo '{output_file}' omitiendo las carpetas especificadas.")

    except IOError as e:
        print(f"Error al escribir en el archivo: {e}")