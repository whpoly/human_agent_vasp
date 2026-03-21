CREATE_WORKFLOW_EXAMPLE = {
    "title": "Fe2O3 geometry optimization",
    "goal": "Relax a hematite bulk structure before a follow-up static calculation.",
    "material_system": "transition-metal oxide bulk",
    "calculation_type": "relaxation",
    "constraints": {
        "species": ["Fe", "O"],
        "minimum_encut": 520,
        "scheduler_type": "slurm",
        "ntasks": 64,
        "walltime": "08:00:00",
    },
    "structure_text": "Fe2O3 POSCAR content goes here",
}
