create table if not exists public.retraining_sample(
    id bigserial primary key,
    model_result_id bigint,
    image_id bigint,
    status varchar(255),
    create_date timestamp,
    constraint fk_classification_result_id foreign key (model_result_id) references public.classification_result(id) on delete cascade,
    constraint fk_minio_image_id foreign key (image_id) references public.minio_file(id) on delete cascade
);

create table if not exists public.prototype(
    id bigserial primary key,
    job_id bigint,
    prototype_name varchar(255),
    create_date timestamp,
    constraint fk_job_id_prototype foreign key (job_id) references public.processing_jobs(id) on delete cascade
);

create table if not exists public.prototype_image(
    id bigserial primary key,
    prototype_id bigint,
    image_id bigint,
    segmentation_file_id bigint,
    create_date timestamp,
    constraint fk_prototype_id foreign key (prototype_id) references public.prototype(id) on delete cascade,
    constraint fk_image_id foreign key (image_id) references  public.minio_file(id) on delete cascade,
    constraint fk_segmentation_result_id foreign key (segmentation_file_id)  references  public.minio_file(id) on delete cascade
);